import { useState, useEffect } from 'react';

function ClockTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return (
    <span className="t-mono" style={{ fontSize: 13, letterSpacing: '0.06em', color: 'var(--ink)' }}>
      {hh}:{mm}<span style={{ color: 'var(--ink-mute)' }}>:{ss}</span>
    </span>
  );
}

function PulseRing({ value, total, label }) {
  const R = 12;
  const C = 2 * Math.PI * R;
  const off = C * (1 - value / total);
  return (
    <div className="pulse-ring">
      <svg width="28" height="28" style={{ display: 'block', transform: 'rotate(-90deg)' }}>
        <circle cx="14" cy="14" r={R} fill="none" stroke="var(--rule)" strokeWidth="1.5" />
        <circle
          cx="14" cy="14" r={R}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeDasharray={C}
          strokeDashoffset={off}
          strokeLinecap="butt"
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <div className="ring-num">{label}</div>
    </div>
  );
}

export default function Header({
  currentPage,
  onNavigate,
  onQuickSearch,
  refreshCountdown,
  refreshInterval,
  lastRefreshed,
  onRefreshNow,
}) {
  const [query, setQuery] = useState('');

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && query.trim()) {
      if (onQuickSearch) onQuickSearch(query.trim());
      if (onNavigate) onNavigate('search');
    }
  };

  const cdTotal = refreshInterval || 300;
  const cdValue = refreshCountdown || 0;
  const m = Math.floor(cdValue / 60);
  const s = cdValue % 60;
  const cdLabel = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;

  return (
    <div className="strip">
      <div className="strip-cell">
        <span className="label">Time</span>
        <ClockTime />
      </div>

      <div className="strip-cell grow">
        <div className="row gap-8" style={{ alignItems: 'center' }}>
          <span className="led on" />
          <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>All systems online</span>
        </div>
      </div>

      <div className="strip-cell" style={{ minWidth: 180 }}>
        <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>⌕</span>
        <input
          type="text"
          placeholder="Search couple name…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            border: 0,
            background: 'transparent',
            fontSize: 13,
            color: 'var(--ink)',
            outline: 0,
            flex: 1,
          }}
        />
      </div>

      <div className="strip-cell">
        <button
          className="btn ghost sm"
          onClick={onRefreshNow}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          title="Click to refresh now"
        >
          <PulseRing
            value={cdTotal - cdValue}
            total={cdTotal}
            label={cdLabel}
          />
          <span>Refresh</span>
        </button>
      </div>

      <div className="strip-cell" style={{ borderRight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 999,
            display: 'grid', placeItems: 'center',
            fontWeight: 600, fontSize: 13,
            color: 'var(--panel)', background: 'var(--ink)',
          }}>B</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500, lineHeight: 1.2 }}>Bilal</span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>TXB Studios</span>
          </div>
        </div>
      </div>
    </div>
  );
}
