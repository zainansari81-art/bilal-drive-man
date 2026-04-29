"""
live_progress.py — high-cadence download-progress emitter (scanner v3.53.0).

PURPOSE
-------
Sit alongside the existing per-file `api_request('download-progress', ...)`
emit and push a richer state record (per-file detail + current/avg
download throughput) to /api/download-progress-live every ~1.5s.

The endpoint upserts into `download_progress_live` keyed by project_id;
the dashboard polls that table and shows a live progress card.

WHY A SEPARATE MODULE
---------------------
This is a NEW telemetry channel. The existing `download-progress` emit
flow is unchanged. If the live emitter misbehaves (network down,
endpoint 500ing, threading bug), the scanner's actual download work
is unaffected — every public method here is wrapped in try/except and
either logs + drops or returns silently.

Two ways to disable, in order of severity:
  1. Set env var LIVE_PROGRESS_ENABLED=0 (or unset). The scanner's
     drive_scanner.py checks this once at import time; when off, it
     installs a no-op shim instead of LiveProgressTracker, so all
     hook calls become free function calls.
  2. Comment out the three call sites in drive_scanner.py
     (init/update/stop). The module is otherwise unreferenced.

NUMBERS WE TRACK
----------------
    instant_speed_bps : delta-bytes / delta-time over the last sample
                        window (~1.5s). Choppy but real-time.
    rolling_avg_bps   : average over the last ~10s (smoother UI number).
    true_avg_bps      : cumulative_bytes / wall-clock since started_at.
                        This is the number we freeze in the "Done —
                        averaged X" line at end of run.

DROPBOX MODE
------------
For Dropbox, the desktop client does the actual downloading and the
scanner just waits for `os.path.isdir` to flip true / files to be
fully offline. We can't get per-file metadata, but we CAN sample the
on-disk size of the watched folder periodically. That gives us a
crude but useful real-time progress + speed even though the existing
download-progress emit only updates once per check_folder_offline_status
tick (every 30s).
"""
from __future__ import annotations

import collections
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request


# ─── Feature flag ───────────────────────────────────────────────────────
#
# Read once at import. Off by default — the scanner explicitly opts in
# by setting LIVE_PROGRESS_ENABLED=1 in its env. Belt-and-suspenders:
# even when the env var is set, every public entry point here catches
# all exceptions, so a bug in this file never crashes a download.
#
# We treat truthy strings ('1', 'true', 'yes') as enabled — matches
# how Zain's other env-flag config in this codebase reads.
def _flag_enabled() -> bool:
    raw = os.environ.get('LIVE_PROGRESS_ENABLED', '').strip().lower()
    return raw in ('1', 'true', 'yes', 'on')


ENABLED = _flag_enabled()


# ─── Sample math ────────────────────────────────────────────────────────

# Window for rolling average, in seconds. Roughly 10s of recent samples
# gives a smooth number that still tracks real changes (e.g. WiFi
# dropping out during a download). Smaller = jumpier; larger = staler.
ROLLING_AVG_WINDOW_S = 10.0

# Minimum interval between live emits, in seconds. The Dropbox sampler
# actually does the disk walk at this cadence too. 1.5s feels real-time
# in the UI without hammering Vercel; the existing download-progress
# emit at ~30s remains the canonical channel for download_projects.
EMIT_INTERVAL_S = 1.5

# Folder-walk safety cap. If a Dropbox folder has more than this many
# files we stop sampling on-disk size mid-walk and just emit "still
# sampling" — protects against a 100k-file project where each scandir
# takes longer than the emit interval.
DROPBOX_WALK_HARD_TIMEOUT_S = 4.0


class _Sample:
    """One (timestamp, cumulative-bytes) reading. Compact tuple-ish so
    we can keep a couple hundred in a deque without GC pressure."""
    __slots__ = ('t', 'b')

    def __init__(self, t: float, b: int):
        self.t = t
        self.b = b


# ─── Public tracker ─────────────────────────────────────────────────────

class LiveProgressTracker:
    """One instance per project. Created at start_download time, updated
    inline by GDrive _download_task (synchronous calls), or driven by
    a background thread for Dropbox folder sampling. Always call
    `stop()` exactly once when the project's download phase finishes.

    Thread-safety: _lock guards mutations to _samples and _state.
    Public methods are safe to call from any thread.
    """

    def __init__(self, config: dict, project_id: str, source: str,
                 api_key: str = ''):
        self.config = config
        # API key is sourced from drive_scanner.API_KEY (already
        # populated from env / config.json at module load). We accept
        # it explicitly rather than re-reading config so the rules for
        # where the key comes from stay in one place.
        self.api_key = api_key or config.get('api_key', '') or os.environ.get('SCANNER_API_KEY', '')
        self.project_id = project_id
        self.source = source  # 'gdrive' | 'dropbox' | 'wetransfer'

        self._lock = threading.Lock()
        self._samples: collections.deque[_Sample] = collections.deque(maxlen=200)
        self._started_at = time.time()
        self._cumulative_bytes = 0
        self._total_bytes = 0
        self._current_file_name: str | None = None
        self._current_file_index: int | None = None
        self._total_files: int | None = None
        self._current_file_bytes: int | None = None
        self._current_file_size: int | None = None
        self._phase: str | None = None
        self._stopped = False

        # Background sampler — only started for Dropbox sync mode (where
        # progress is invisible without folder-size walking). GDrive
        # path drives updates inline so it doesn't need a thread.
        self._sampler_thread: threading.Thread | None = None
        self._sampler_stop = threading.Event()
        self._sampler_folder: str | None = None

        # Last-emit throttle — avoid hammering the endpoint when the
        # GDrive task completes 50 small files in a second.
        self._last_emit_t = 0.0

    # ── GDrive / WeTransfer call sites ─────────────────────────────────

    def update_gdrive(self, *, cumulative_bytes: int, total_bytes: int,
                      current_file_name: str | None = None,
                      current_file_index: int | None = None,
                      total_files: int | None = None,
                      current_file_size: int | None = None,
                      phase: str = 'gdrive_staging') -> None:
        """Called from inside `_download_task` after each file completes.
        Cheap; throttled internally so calling it 1000 times in a second
        is fine — only ~every 1.5s actually hits the network."""
        try:
            with self._lock:
                self._cumulative_bytes = max(self._cumulative_bytes, int(cumulative_bytes))
                self._total_bytes = max(self._total_bytes, int(total_bytes))
                if current_file_name is not None:
                    self._current_file_name = current_file_name
                if current_file_index is not None:
                    self._current_file_index = int(current_file_index)
                if total_files is not None:
                    self._total_files = int(total_files)
                if current_file_size is not None:
                    self._current_file_size = int(current_file_size)
                self._current_file_bytes = self._current_file_size
                self._phase = phase
                self._samples.append(_Sample(time.time(), self._cumulative_bytes))
            self._maybe_emit()
        except Exception as e:  # pragma: no cover — defensive
            logging.debug(f"live_progress update_gdrive swallowed: {e}")

    # ── Dropbox call sites ────────────────────────────────────────────

    def start_dropbox_sampler(self, folder: str, total_bytes_hint: int = 0,
                              phase: str = 'syncing') -> None:
        """Spawn the background folder-size sampler. Idempotent — calling
        it twice without an intervening stop_sampler() is a no-op (the
        first thread keeps running). The thread exits when stop() or
        stop_sampler() is called or when the live tracker is stopped.

        `total_bytes_hint` is optional. If the caller knows the cloud-side
        total (we don't for plain Dropbox sync — only after pin), pass it
        so the UI bar renders the right denominator from sample 1.
        """
        if not ENABLED:
            return
        try:
            with self._lock:
                if self._sampler_thread is not None and self._sampler_thread.is_alive():
                    return
                self._sampler_folder = folder
                self._sampler_stop.clear()
                if total_bytes_hint > 0:
                    self._total_bytes = int(total_bytes_hint)
                self._phase = phase

            t = threading.Thread(
                target=self._dropbox_sampler_loop,
                name=f'live-progress-dbx-{self.project_id[:8]}',
                daemon=True,
            )
            t.start()
            with self._lock:
                self._sampler_thread = t
        except Exception as e:  # pragma: no cover
            logging.debug(f"live_progress start_dropbox_sampler swallowed: {e}")

    def stop_sampler(self) -> None:
        """Stop the Dropbox sampler thread without ending the tracker.
        Useful when transitioning from syncing → copying phases."""
        try:
            self._sampler_stop.set()
            t = None
            with self._lock:
                t = self._sampler_thread
                self._sampler_thread = None
            if t is not None:
                # Don't block forever — sampler does at most one disk
                # walk between stop checks (capped at ~4s).
                t.join(timeout=DROPBOX_WALK_HARD_TIMEOUT_S + 1.0)
        except Exception as e:  # pragma: no cover
            logging.debug(f"live_progress stop_sampler swallowed: {e}")

    def update_phase(self, phase: str) -> None:
        """Notify the tracker that the download has moved to a new
        phase ('pinning' → 'syncing' → 'copying'). Cheap — just
        relabels the next emit."""
        try:
            with self._lock:
                self._phase = phase
            self._maybe_emit(force=True)
        except Exception as e:  # pragma: no cover
            logging.debug(f"live_progress update_phase swallowed: {e}")

    # ── Lifecycle ─────────────────────────────────────────────────────

    def stop(self, *, success: bool = True) -> None:
        """Final emit. Marks the row complete in the DB so the UI
        freezes the card in 'Done — averaged X' state. Safe to call
        twice (later calls no-op)."""
        try:
            with self._lock:
                if self._stopped:
                    return
                self._stopped = True
            self.stop_sampler()
            # One final emit with phase='complete' + completed=True so
            # the API stamps completed_at server-side.
            with self._lock:
                payload = self._build_payload()
                payload['phase'] = 'complete' if success else (self._phase or '')
                payload['completed'] = True
            self._post(payload)
        except Exception as e:  # pragma: no cover
            logging.debug(f"live_progress stop swallowed: {e}")

    # ── Internals ─────────────────────────────────────────────────────

    def _dropbox_sampler_loop(self) -> None:
        """Walk the Dropbox folder periodically, sum file sizes, and
        treat that as cumulative_bytes downloaded. Doesn't distinguish
        downloaded-vs-placeholder files — for Dropbox's "make
        available offline" pin model that's a fine approximation."""
        while not self._sampler_stop.is_set() and not self._stopped:
            folder = self._sampler_folder
            if folder and os.path.isdir(folder):
                size = self._safe_folder_size(folder)
                with self._lock:
                    if size > self._cumulative_bytes:
                        self._cumulative_bytes = size
                    self._samples.append(_Sample(time.time(), self._cumulative_bytes))
                self._maybe_emit()
            # Use Event.wait so stop_sampler can interrupt us mid-sleep.
            self._sampler_stop.wait(EMIT_INTERVAL_S)

    @staticmethod
    def _safe_folder_size(folder: str) -> int:
        """Recursively sum file sizes under `folder`, with a wall-clock
        cap so a huge tree can't block the sampler thread for minutes
        and starve other downloads on the same scanner."""
        deadline = time.time() + DROPBOX_WALK_HARD_TIMEOUT_S
        total = 0
        try:
            stack = [folder]
            while stack and time.time() < deadline:
                d = stack.pop()
                try:
                    with os.scandir(d) as it:
                        for entry in it:
                            if time.time() > deadline:
                                return total
                            try:
                                if entry.is_file(follow_symlinks=False):
                                    total += entry.stat(follow_symlinks=False).st_size
                                elif entry.is_dir(follow_symlinks=False):
                                    stack.append(entry.path)
                            except (OSError, PermissionError):
                                continue
                except (OSError, PermissionError):
                    continue
        except Exception:
            return total
        return total

    def _maybe_emit(self, *, force: bool = False) -> None:
        """Throttled emit. Releases the lock before the network call so
        update_gdrive doesn't block on slow Vercel."""
        now = time.time()
        if not force and (now - self._last_emit_t) < EMIT_INTERVAL_S:
            return
        self._last_emit_t = now
        with self._lock:
            payload = self._build_payload()
        self._post(payload)

    def _build_payload(self) -> dict:
        """Caller must hold self._lock."""
        # Speeds:
        instant = self._instant_speed_locked()
        rolling = self._rolling_speed_locked(window_s=ROLLING_AVG_WINDOW_S)
        elapsed = max(time.time() - self._started_at, 0.001)
        true_avg = self._cumulative_bytes / elapsed
        return {
            'project_id': self.project_id,
            'current_file_name': self._current_file_name,
            'current_file_index': self._current_file_index,
            'total_files': self._total_files,
            'current_file_bytes': self._current_file_bytes,
            'current_file_size': self._current_file_size,
            'cumulative_bytes': self._cumulative_bytes,
            'total_bytes': self._total_bytes,
            'instant_speed_bps': int(max(instant, 0)),
            'rolling_avg_bps': int(max(rolling, 0)),
            'true_avg_bps': int(max(true_avg, 0)),
            'phase': self._phase or '',
            'source': self.source,
        }

    def _instant_speed_locked(self) -> float:
        """Bytes/sec over the last 2 samples. Caller must hold the lock."""
        if len(self._samples) < 2:
            return 0.0
        a = self._samples[-2]
        b = self._samples[-1]
        dt = b.t - a.t
        if dt <= 0:
            return 0.0
        return max(b.b - a.b, 0) / dt

    def _rolling_speed_locked(self, *, window_s: float) -> float:
        """Bytes/sec averaged over the last `window_s` of samples. Caller
        must hold the lock."""
        if not self._samples:
            return 0.0
        latest = self._samples[-1]
        cutoff = latest.t - window_s
        # Pick the oldest sample inside the window (or the very first
        # if the deque is shorter than the window).
        oldest = self._samples[0]
        for s in self._samples:
            if s.t >= cutoff:
                oldest = s
                break
        dt = latest.t - oldest.t
        if dt <= 0:
            return 0.0
        return max(latest.b - oldest.b, 0) / dt

    def _post(self, payload: dict) -> None:
        """Fire-and-forget POST to /api/download-progress-live. Network
        failures are logged-and-swallowed so the download keeps running
        even if Vercel is having a bad day."""
        try:
            url = f"{self.config['api_url']}/api/download-progress-live"
            body = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(url, data=body, method='POST')
            req.add_header('Content-Type', 'application/json')
            if self.api_key:
                req.add_header('x-api-key', self.api_key)
            # Short timeout — if the live endpoint is slow, drop the
            # sample rather than back-pressure the sampler thread.
            with urllib.request.urlopen(req, timeout=5):
                pass
        except urllib.error.HTTPError as e:
            # 4xx with a body usually means a schema mismatch —
            # log once-ish so we notice during smoke testing.
            try:
                err_body = e.read().decode()[:200]
            except Exception:
                err_body = ''
            logging.debug(f"live_progress POST {e.code}: {err_body}")
        except Exception as e:
            logging.debug(f"live_progress POST failed: {e}")


# ─── No-op shim ─────────────────────────────────────────────────────────
#
# When ENABLED is False we still want drive_scanner.py's call sites to
# work without conditional checks at every line. `make_tracker()` returns
# a real tracker if enabled, else an instance whose every public method
# is a no-op. Keeps the call sites looking the same.

class _NullTracker:
    def update_gdrive(self, **kwargs): pass
    def start_dropbox_sampler(self, *args, **kwargs): pass
    def stop_sampler(self): pass
    def update_phase(self, *args, **kwargs): pass
    def stop(self, **kwargs): pass


def make_tracker(config: dict, project_id: str, source: str, api_key: str = ''):
    """Factory used by drive_scanner.py at the top of handle_start_download
    and handle_add_to_cloud (for GDrive direct download). Returns a
    real LiveProgressTracker when the feature flag is on, otherwise a
    null tracker so the call sites are unconditional.

    Pass `api_key` explicitly (drive_scanner has it as a module-level
    constant from env/config) so we don't duplicate the resolution
    logic here.
    """
    if not ENABLED or not project_id:
        return _NullTracker()
    try:
        return LiveProgressTracker(config, project_id, source, api_key=api_key)
    except Exception as e:  # pragma: no cover
        logging.debug(f"live_progress make_tracker fallback to null: {e}")
        return _NullTracker()
