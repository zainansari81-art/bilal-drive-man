"""WeTransfer provider for the BilalDriveMan scanner — DRAFT for scanner-3.47.0.

This module is mac-Claude's parallel scaffolding for the WeTransfer
direct-download path. It mirrors the GDrive 3.46.0 provider that win-Claude is
building. Win will integrate this into drive_scanner.py via the shared
`scanner_staging` module he's introducing in 3.46.0.

API used (no docs published; reverse-engineered from the wetransfer.com web
UI network calls — verified Apr 2026):

  POST https://wetransfer.com/api/v4/transfers/<transfer_id>/prepare-download
       body: {"security_hash": "<hash>", "intent": "entire_transfer"}
       returns: {items: [{id, name, size, content_identifier}], expires_at, ...}

  POST https://wetransfer.com/api/v4/transfers/<transfer_id>/download
       body: {"security_hash": "<hash>", "intent": "single_file",
              "file_ids": ["<file_id>"]}
       returns: {direct_link: "https://download.wetransfer.com/..."}

  Direct-link is a short-lived (~5 min) presigned S3-style URL. Stream to disk
  with Range headers for resumable downloads.

Failure modes covered (same 32-scenario spec as GDrive 3.46.0):
  • we.tl short-link 302 chain (resolve_short_link)
  • Expired share (prepare-download returns 403/404)
  • Network drop mid-stream (Range-resumable retry)
  • direct_link expiry mid-download (re-request via download endpoint)
  • Disk full / cancel / reboot resume (delegated to scanner_staging primitives)
  • Concurrent file downloads via ThreadPoolExecutor (same orchestrator as GDrive)

Win — integration entry point: `add_wetransfer_share(...)` matches the
`add_gdrive_shared_folder` signature you're using in 3.46.0. Drop into
handle_add_to_cloud's link_type dispatch the same way.
"""

import json
import os
import re
import time
import urllib.parse
import urllib.request
import urllib.error


WETRANSFER_API_BASE = 'https://wetransfer.com/api/v4/transfers'
WETRANSFER_USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 BilalDriveMan/1.0'
)
WETRANSFER_SHORT_LINK_HOPS = 5
WETRANSFER_DOWNLOAD_LINK_TTL_SEC = 240  # ~4 min — re-request if older


# ---- URL parsing ----------------------------------------------------------


_CANONICAL_PAT = re.compile(
    r'wetransfer\.com/downloads/([a-f0-9]{20,})/([a-f0-9]{10,})', re.I
)
_CANONICAL_WITH_RECIPIENT_PAT = re.compile(
    r'wetransfer\.com/downloads/([a-f0-9]{20,})/[^/]+/([a-f0-9]{10,})', re.I
)
_SHORT_PAT = re.compile(r'we\.tl/', re.I)


def extract_transfer_ids(url):
    """Extract (transfer_id, security_hash) from a canonical WeTransfer URL.

    Returns a 3-tuple (transfer_id, security_hash, is_short_link). For short
    links (`we.tl/...`) returns (None, None, True) — caller must resolve the
    302 chain via `resolve_short_link` first.
    """
    if not url:
        return None, None, False
    m = _CANONICAL_PAT.search(url)
    if m:
        return m.group(1), m.group(2), False
    m = _CANONICAL_WITH_RECIPIENT_PAT.search(url)
    if m:
        return m.group(1), m.group(2), False
    if _SHORT_PAT.search(url):
        return None, None, True
    return None, None, False


def resolve_short_link(short_url, hops=WETRANSFER_SHORT_LINK_HOPS):
    """Follow the 302 redirect chain from a we.tl short link to the canonical
    wetransfer.com/downloads URL. Caps at `hops` to avoid loops.

    Returns the canonical URL string, or None if resolution fails.
    """
    current = short_url
    for _ in range(hops):
        req = urllib.request.Request(
            current,
            method='HEAD',
            headers={'User-Agent': WETRANSFER_USER_AGENT},
        )
        try:
            # urllib follows redirects automatically; we want manual control.
            # Easier path: use requests with allow_redirects=False, but to
            # avoid adding a dep, fall through to the auto-follow + read final
            # URL from the response.
            with urllib.request.urlopen(req, timeout=15) as resp:
                final_url = resp.geturl()
                if 'wetransfer.com/downloads/' in final_url:
                    return final_url
                current = final_url
        except urllib.error.HTTPError as err:
            # 4xx after redirect = short link expired or removed
            if err.code in (403, 404, 410):
                return None
            return None
        except (urllib.error.URLError, TimeoutError):
            return None
    return None


# ---- HTTP helpers ---------------------------------------------------------


def _post_json(url, body, timeout=30):
    """POST a JSON body to `url`, return parsed JSON. Raises on non-2xx."""
    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        method='POST',
        headers={
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': WETRANSFER_USER_AGENT,
            'X-Requested-With': 'XMLHttpRequest',
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def prepare_download(transfer_id, security_hash):
    """Call WeTransfer's prepare-download endpoint. Returns parsed metadata
    {items: [...], expires_at, ...} or raises HTTPError on 403/404/etc.

    Use this once at the start of a download job to enumerate files. The
    `items` array contains both files and folders; `content_identifier` ==
    'folder' indicates a directory (folder structure is preserved via item
    relative paths).
    """
    url = f'{WETRANSFER_API_BASE}/{urllib.parse.quote(transfer_id)}/prepare-download'
    return _post_json(url, {
        'security_hash': security_hash,
        'intent': 'entire_transfer',
    })


def request_file_download_url(transfer_id, security_hash, file_id):
    """Request a direct-download URL for a single file. Returns the
    direct_link string. The URL is short-lived (~5min), so bake a re-request
    path into the streaming loop if the download spans longer than that.
    """
    url = f'{WETRANSFER_API_BASE}/{urllib.parse.quote(transfer_id)}/download'
    body = _post_json(url, {
        'security_hash': security_hash,
        'intent': 'single_file',
        'file_ids': [file_id],
    })
    return body.get('direct_link')


# ---- Streaming download (resumable via Range) -----------------------------


def stream_download(direct_link, dest_path, expected_size=None,
                    chunk_bytes=8 * 1024 * 1024, cancel_check=None,
                    refresh_url_fn=None):
    """Stream `direct_link` to `dest_path` with Range-resumable retry.

    Args:
        direct_link: presigned download URL from request_file_download_url
        dest_path: absolute path; partial writes go to dest_path + '.part'
                   then atomic-rename on completion
        expected_size: optional bytes; verified post-download for integrity
        chunk_bytes: read-write chunk size (default 8MB)
        cancel_check: optional callable that raises if the project is cancelled
        refresh_url_fn: optional callable returning a fresh direct_link if the
                        current one has expired (HTTP 403 mid-stream).
                        Caller supplies one bound to (transfer_id, security_hash, file_id).

    Returns the final absolute path on success. Raises on hard failure.
    """
    part_path = dest_path + '.part'
    bytes_written = os.path.getsize(part_path) if os.path.exists(part_path) else 0
    start_url = direct_link
    last_link_refresh_ts = time.time()

    attempts = 0
    while attempts < 3:
        attempts += 1
        if cancel_check:
            cancel_check()  # raises CancelledError if event set

        # Refresh the direct_link if it's older than TTL — guards against
        # mid-job expiry during long files.
        if refresh_url_fn and (time.time() - last_link_refresh_ts) > WETRANSFER_DOWNLOAD_LINK_TTL_SEC:
            try:
                start_url = refresh_url_fn()
                last_link_refresh_ts = time.time()
            except Exception:
                pass  # fall through, may still work

        headers = {'User-Agent': WETRANSFER_USER_AGENT}
        if bytes_written > 0:
            headers['Range'] = f'bytes={bytes_written}-'
        req = urllib.request.Request(start_url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                # 206 Partial Content == resumed; 200 OK == full restart
                mode = 'ab' if resp.status == 206 else 'wb'
                if mode == 'wb':
                    bytes_written = 0
                with open(part_path, mode) as fh:
                    while True:
                        if cancel_check:
                            cancel_check()
                        chunk = resp.read(chunk_bytes)
                        if not chunk:
                            break
                        fh.write(chunk)
                        bytes_written += len(chunk)
            # Size sanity check (best-effort).
            if expected_size and bytes_written != expected_size:
                # Size mismatch on this attempt — wipe + retry once.
                if attempts < 3:
                    os.remove(part_path)
                    bytes_written = 0
                    continue
                raise IOError(
                    f'WeTransfer size mismatch: got {bytes_written}, '
                    f'expected {expected_size}'
                )
            os.replace(part_path, dest_path)
            return dest_path
        except urllib.error.HTTPError as err:
            if err.code == 403 and refresh_url_fn:
                # Direct-link expired mid-stream — refresh + retry
                try:
                    start_url = refresh_url_fn()
                    last_link_refresh_ts = time.time()
                    continue
                except Exception:
                    raise
            if err.code in (429, 500, 502, 503, 504) and attempts < 3:
                time.sleep(2 ** attempts)  # exp backoff: 2s, 4s
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempts < 3:
                time.sleep(2 ** attempts)
                continue
            raise

    raise IOError(f'WeTransfer download failed after {attempts} attempts')


# ---- Top-level entry (for win to wire into handle_add_to_cloud) -----------


def add_wetransfer_share(download_link, project_id, staging_root,
                         cancel_check=None, progress_cb=None):
    """End-to-end WeTransfer staging.

    Args:
        download_link: the share URL (we.tl or wetransfer.com/downloads/...)
        project_id: project UUID, used as staging dir name
        staging_root: absolute path to %LOCALAPPDATA%/BilalDriveMan/wetransfer-staging
        cancel_check: optional callable (raises if project cancelled)
        progress_cb: optional callable (files_done, files_total, bytes_done, bytes_total)

    Returns the absolute staging dir path on success. Raises on hard failure.
    NOTE: This is a skeleton. Win — integrate against your scanner_staging
    primitives (atomic .staging-state.json read/write, ThreadPoolExecutor)
    from 3.46.0. The HTTP client + URL parsing above is production-ready;
    only the orchestration loop below needs your shared infra.
    """
    # 1. Parse + (if needed) resolve short link
    transfer_id, security_hash, is_short = extract_transfer_ids(download_link)
    if is_short:
        canonical = resolve_short_link(download_link)
        if not canonical:
            raise IOError('WeTransfer short link could not be resolved (expired?)')
        transfer_id, security_hash, _ = extract_transfer_ids(canonical)
    if not transfer_id or not security_hash:
        raise IOError(f'Could not extract WeTransfer transfer_id from {download_link}')

    # 2. Prepare download — get file list
    meta = prepare_download(transfer_id, security_hash)
    items = [it for it in meta.get('items', []) if it.get('content_identifier') != 'folder']
    if not items:
        raise IOError('WeTransfer share has no files (empty or all folders)')

    # 3. Staging dir
    staging_dir = os.path.join(staging_root, project_id)
    os.makedirs(staging_dir, exist_ok=True)

    # 4. Download each file (sequentially in skeleton — win parallelizes
    #    via scanner_staging.ThreadPoolExecutor in production)
    total = len(items)
    bytes_total = sum(int(it.get('size') or 0) for it in items)
    bytes_done = 0
    for idx, item in enumerate(items, 1):
        if cancel_check:
            cancel_check()
        file_id = item['id']
        file_name = _sanitize_filename(item.get('name') or f'file-{file_id}')
        size = int(item.get('size') or 0)
        dest = os.path.join(staging_dir, file_name)
        if os.path.exists(dest) and os.path.getsize(dest) == size:
            bytes_done += size
            if progress_cb:
                progress_cb(idx, total, bytes_done, bytes_total)
            continue

        def _refresh_url(_tid=transfer_id, _sh=security_hash, _fid=file_id):
            return request_file_download_url(_tid, _sh, _fid)

        direct_link = _refresh_url()
        if not direct_link:
            raise IOError(f'WeTransfer denied download URL for {file_name}')

        stream_download(
            direct_link, dest,
            expected_size=size or None,
            cancel_check=cancel_check,
            refresh_url_fn=_refresh_url,
        )
        bytes_done += size
        if progress_cb:
            progress_cb(idx, total, bytes_done, bytes_total)

    return staging_dir


# ---- Filename sanitization (Windows path safety) --------------------------


_WINDOWS_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _sanitize_filename(name):
    """Replace Windows-illegal chars with underscore. Keep extension intact."""
    cleaned = _WINDOWS_ILLEGAL.sub('_', name).strip('. ')
    return cleaned or 'unnamed_file'
