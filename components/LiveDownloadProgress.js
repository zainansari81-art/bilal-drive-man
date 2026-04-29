// LiveDownloadProgress — high-cadence progress card (v3.53.0).
//
// Renders next to the existing per-row progress bar in DownloadingProPage
// and shows scanner-emitted live state from /api/download-progress-live:
//
//   * Per-file detail (GDrive / WeTransfer): "file 45 of 230 — clip_045.mp4"
//   * Aggregate progress bar: "4.2 GB / 18.7 GB (22%)"
//   * Current download throughput: "12.4 MB/s"
//   * Rolling 10s avg
//   * On completion: "Done — averaged 8.7 MB/s over 38m 12s"
//
// SAFETY: this component is purely additive. If the live row doesn't exist
// (scanner running with LIVE_PROGRESS_ENABLED=false, or pre-feature
// scanner build), the API returns null and we render nothing — the
// existing row UI is unchanged. If the polling fetch fails entirely, we
// also render nothing rather than showing an error chrome that would
// confuse the user.
//
// To globally disable from the dashboard side, unset
// NEXT_PUBLIC_LIVE_PROGRESS — DownloadingProPage gates the mount on it.

import { useEffect, useRef, useState } from 'react';
import { formatSize } from '../lib/format';

const POLL_INTERVAL_MS = 1500;

// Format bytes/sec as a human string. Uses bits-style decimal for speed
// (MB/s = 10^6 by convention in network UIs would be wrong here — we
// measure download throughput in IEC binary, same as formatSize).
function formatSpeed(bps) {
  if (!bps || bps <= 0) return '—';
  return `${formatSize(bps)}/s`;
}

// Format an elapsed duration as "Xh Ym Zs" / "Ym Zs" / "Zs".
function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function LiveDownloadProgress({ projectId, status }) {
  const [live, setLive] = useState(null);
  const [reachable, setReachable] = useState(true);
  // Once the project leaves an active phase (downloading/copying), we
  // stop polling. Keep the last frame on screen so the user can read
  // the final avg-speed line for a few seconds before navigating away.
  const lastSeenRef = useRef(null);

  useEffect(() => {
    if (!projectId) return undefined;

    let cancelled = false;
    let timer = null;

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/download-progress-live?project_id=${encodeURIComponent(projectId)}`,
          { credentials: 'same-origin' }
        );
        if (!res.ok) {
          // 401 / 500 — treat as "not reachable", hide the card. We
          // intentionally don't surface an error chrome; the existing
          // progress bar still works.
          if (!cancelled) setReachable(false);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setReachable(true);
        if (data) {
          lastSeenRef.current = data;
          setLive(data);
        } else if (lastSeenRef.current) {
          // No row yet, but we had one earlier — keep showing the
          // last frame (likely the terminal "complete" emit was
          // delivered + the row stayed; or the scanner hasn't started
          // emitting yet for a queued-then-restarted project).
          setLive(lastSeenRef.current);
        } else {
          setLive(null);
        }
      } catch {
        if (!cancelled) setReachable(false);
      }
    };

    // Per spec: only the 'downloading' phase polls fast. Anything else
    // does one final tick (to render the freeze frame from the last
    // live row) and stops — copying / completed / failed don't need
    // realtime speed tracking and we don't want the polling load.
    const isActive = status === 'downloading';
    tick();
    if (isActive) {
      timer = setInterval(tick, POLL_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [projectId, status]);

  if (!reachable || !live) return null;

  const cumulative = Number(live.cumulative_bytes || 0);
  const total = Number(live.total_bytes || 0);
  const pct = total > 0 ? Math.min((cumulative / total) * 100, 100) : null;
  const isComplete = live.phase === 'complete' || live.completed_at;

  // Per-file line: only render when scanner gave us file-level info
  // (GDrive direct download, WeTransfer staging). Dropbox sync mode
  // leaves these NULL and we just show aggregate.
  const hasFileInfo =
    live.current_file_name &&
    live.total_files != null &&
    live.current_file_index != null;

  // True-avg duration: completed_at - started_at when completed,
  // else now - started_at.
  let elapsedMs = null;
  if (live.started_at) {
    const start = new Date(live.started_at).getTime();
    const end = isComplete && live.completed_at
      ? new Date(live.completed_at).getTime()
      : Date.now();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      elapsedMs = end - start;
    }
  }

  return (
    <div
      className="dp-live-progress"
      style={{
        marginTop: 8,
        padding: '10px 12px',
        borderRadius: 10,
        background: isComplete ? '#f0fdf4' : '#f8fafc',
        border: `1px solid ${isComplete ? '#bbf7d0' : '#e5e7eb'}`,
        fontSize: 12,
        color: '#1a1a2e',
        lineHeight: 1.5,
      }}
    >
      {hasFileInfo && !isComplete && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <span style={{ color: '#4a4a6a', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {live.current_file_name}
          </span>
          <span style={{ color: '#8c8ca1', whiteSpace: 'nowrap' }}>
            file {live.current_file_index} of {live.total_files}
          </span>
        </div>
      )}

      {pct != null && !isComplete && (
        <>
          <div className="drive-progress-bar" style={{ marginBottom: 4 }}>
            <div
              className="drive-progress-fill"
              style={{
                width: `${pct}%`,
                background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8c8ca1', fontSize: 11 }}>
            <span>{formatSize(cumulative)} / {formatSize(total)}</span>
            <span>{pct.toFixed(1)}%</span>
          </div>
        </>
      )}

      {!isComplete && (
        <div style={{ display: 'flex', gap: 12, marginTop: 6, color: '#4a4a6a', fontSize: 11 }}>
          <span>
            <span style={{ color: '#8c8ca1' }}>Speed: </span>
            <span style={{ fontWeight: 600 }}>{formatSpeed(live.instant_speed_bps)}</span>
          </span>
          {live.rolling_avg_bps != null && (
            <span>
              <span style={{ color: '#8c8ca1' }}>10s avg: </span>
              <span style={{ fontWeight: 600 }}>{formatSpeed(live.rolling_avg_bps)}</span>
            </span>
          )}
        </div>
      )}

      {isComplete && (
        <div style={{ color: '#15803d', fontWeight: 600 }}>
          {'✓'} Done — {formatSize(cumulative)} averaged {formatSpeed(live.true_avg_bps)}
          {elapsedMs != null && <span style={{ color: '#4a4a6a', fontWeight: 400 }}> over {formatDuration(elapsedMs)}</span>}
        </div>
      )}
    </div>
  );
}
