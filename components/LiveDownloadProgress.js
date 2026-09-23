// LiveDownloadProgress — high-cadence progress card (v3.53.0 + console-ui restyle).
//
// Polls /api/download-progress-live while status === 'downloading': every 5s
// once a live row exists, every 30s until then; paused while the tab is hidden.
// Renders nothing when the live row doesn't exist (scanner off, or pre-feature build).
// Restyled chrome to match .live-detail from styles/globals.css (console.css).

import { useEffect, useRef, useState } from 'react';
import { formatSize } from '../lib/format';
import { whenVisible } from '../lib/polling';

const POLL_INTERVAL_MS = 5000;
// The scanner's live emitter is opt-in (LIVE_PROGRESS_ENABLED), so most
// downloads never get a live row. Until one appears, check every 30s instead
// of every 5s — the card shows up within 30s of live data starting.
const NO_LIVE_ROW_POLL_INTERVAL_MS = 30000;

function formatSpeed(bps) {
  if (!bps || bps <= 0) return '—';
  return `${formatSize(bps)}/s`;
}

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
          setLive(lastSeenRef.current);
        } else {
          setLive(null);
        }
      } catch {
        if (!cancelled) setReachable(false);
      }
    };

    const isActive = status === 'downloading';
    const pollTick = whenVisible(tick);
    // setTimeout chain (not setInterval) so the delay can follow whether a
    // live row exists yet.
    const scheduleNext = () => {
      if (cancelled || !isActive) return;
      const delay = lastSeenRef.current ? POLL_INTERVAL_MS : NO_LIVE_ROW_POLL_INTERVAL_MS;
      timer = setTimeout(async () => {
        await pollTick();
        scheduleNext();
      }, delay);
    };
    tick().then(scheduleNext);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, status]);

  if (!reachable || !live) return null;

  const cumulative = Number(live.cumulative_bytes || 0);
  const total = Number(live.total_bytes || 0);
  const pct = total > 0 ? Math.min((cumulative / total) * 100, 100) : null;
  const isComplete = live.phase === 'complete' || live.completed_at;

  const hasFileInfo =
    live.current_file_name &&
    live.total_files != null &&
    live.current_file_index != null;

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

  if (isComplete) {
    return (
      <div className="live-detail" style={{ background: 'var(--accent-bg)', borderColor: 'var(--accent)', gridColumn: '1 / -1' }}>
        <div>
          <div style={{ color: 'var(--accent-fg)', fontWeight: 600 }}>
            Done — {formatSize(cumulative)} averaged {formatSpeed(live.true_avg_bps)}
            {elapsedMs != null && (
              <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}> over {formatDuration(elapsedMs)}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="live-detail" style={{ gridColumn: '1 / -1' }}>
      <div>
        {hasFileInfo && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginBottom: 4 }}>
            Now downloading
          </div>
        )}
        {hasFileInfo && (
          <div className="t-mono" style={{ color: 'var(--ink)', fontSize: 13 }}>
            {live.current_file_name}
            <span style={{ color: 'var(--ink-mute)' }}> · file {live.current_file_index} of {live.total_files}</span>
          </div>
        )}
        {pct != null && (
          <div style={{ marginTop: 6 }}>
            <div style={{ height: 4, background: 'var(--rule-soft)', borderRadius: 999, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pct}%`, background: 'var(--accent)', borderRadius: 999, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-mute)', fontSize: 11, marginTop: 3 }}>
              <span>{formatSize(cumulative)} / {formatSize(total)}</span>
              <span>{pct.toFixed(1)}%</span>
            </div>
          </div>
        )}
        <div className="speed-line" style={{ marginTop: 6 }}>
          <span>Now <strong>{formatSpeed(live.instant_speed_bps)}</strong></span>
          {live.rolling_avg_bps != null && (
            <span>10s avg <strong>{formatSpeed(live.rolling_avg_bps)}</strong></span>
          )}
        </div>
      </div>
      {live.rolling_avg_bps && total > 0 && (
        <div style={{ alignSelf: 'center', textAlign: 'right' }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>ETA</div>
          <div className="t-mono" style={{ color: 'var(--ink)', fontSize: 13 }}>
            {Math.max(1, Math.round((total - cumulative) / live.rolling_avg_bps / 60))} min
          </div>
        </div>
      )}
    </div>
  );
}
