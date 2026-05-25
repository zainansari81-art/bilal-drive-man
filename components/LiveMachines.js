import { useEffect, useState } from 'react';
import { LED, SectionHead, Empty } from './atoms';

const REFRESH_MS = 5000;
const ONLINE_THRESHOLD_S = 60;

/**
 * Live machines widget — shows every machine currently sending heartbeats
 * (last_seen ≤ 60s) plus its connected drives. Self-polls every 5s so the
 * dashboard reflects what's actually online right now, independent of the
 * page's main refresh cycle.
 */
export default function LiveMachines() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const res = await fetch('/api/devices', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const arr = data.devices || data || [];
        const now = Date.now();
        const live = arr
          .map((d) => {
            const age = d.lastSeen
              ? Math.round((now - new Date(d.lastSeen).getTime()) / 1000)
              : null;
            const liveDrives = (d.drives || [])
              .filter((x) => x.connected)
              .map((x) => x.label);
            return {
              name: d.name,
              platform: d.platform,
              online: d.isOnline,
              age_s: age,
              drives: liveDrives,
            };
          })
          .filter((d) => d.online && d.age_s != null && d.age_s <= ONLINE_THRESHOLD_S)
          .sort((a, b) => (a.age_s ?? 9e9) - (b.age_s ?? 9e9));
        if (!cancelled) {
          setRows(live);
          setLoading(false);
        }
      } catch (_) {
        // Silent — widget is non-critical; next tick will retry.
      }
    };

    fetchOnce();
    const id = setInterval(fetchOnce, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const fmtAge = (s) => {
    if (s == null) return '—';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    return `${Math.round(s / 3600)}h`;
  };

  return (
    <>
      <SectionHead
        ch={loading ? 'loading…' : `${rows.length} live`}
        title="Live now"
        right={
          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
            heartbeats ≤ {ONLINE_THRESHOLD_S}s · refresh {REFRESH_MS / 1000}s
          </span>
        }
      />
      <div className="panel flush">
        {rows.length === 0 && !loading && (
          <Empty title="No machines online" sub="Scanner agents will appear here when they start heartbeating." />
        )}
        {rows.map((r) => (
          <div className="bay-row" key={r.name}>
            <LED state="on" />
            <div>
              <div className="nm">{r.name}</div>
              <div className="machine">
                {r.platform === 'windows' ? 'Windows' : 'macOS'} · last seen {fmtAge(r.age_s)} ago
              </div>
            </div>
            <div className="use" style={{ gridColumn: 'span 3' }}>
              {r.drives.length === 0 ? (
                <span style={{ color: 'var(--ink-mute)' }}>no drives connected</span>
              ) : (
                r.drives.map((label, i) => (
                  <span
                    key={label}
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      marginRight: 6,
                      borderRadius: 6,
                      background: 'var(--bg-1)',
                      border: '1px solid var(--rule-soft)',
                      fontSize: 12,
                      color: 'var(--ink-2)',
                    }}
                  >
                    {label}
                  </span>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
