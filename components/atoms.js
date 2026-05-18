// Shared atoms — LED, Gauge, Spool, Fuel, Runway, Src, etc.
// Used by all page components.

// ---------- format helpers (replaces window.fmt in the prototype) ----------

export function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const tb = bytes / (1024 ** 4);
  if (tb >= 1) return `${tb.toFixed(2)} TB`;
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(2)} KB`;
}

export function fmtTB(bytes) {
  if (!bytes || bytes === 0) return '0.00';
  return (bytes / (1024 ** 4)).toFixed(2);
}

export function fmtPct(used, total) {
  if (!total || total === 0) return 0;
  return Math.round((used / total) * 100);
}

export function fmtSpeed(bps) {
  if (!bps || bps <= 0) return '—';
  return `${fmtBytes(bps)}/s`;
}

export function sourceFromLink(link) {
  if (!link) return 'unknown';
  if (/dropbox/i.test(link)) return 'dropbox';
  if (/drive\.google|docs\.google/i.test(link)) return 'gdrive';
  if (/we\.tl|wetransfer/i.test(link)) return 'wetransfer';
  return 'unknown';
}

export function sourceLabel(src) {
  return { dropbox: 'Dropbox', gdrive: 'Google Drive', wetransfer: 'WeTransfer', unknown: 'Link' }[src] || 'Link';
}

// ---------- LED indicator ----------

export function LED({ state = 'off', size }) {
  const style = size ? { width: size, height: size } : undefined;
  return <span className={`led ${state}`} style={style} />;
}

// ---------- Smooth progress bar ----------

export function Gauge({ pct, sm, xs }) {
  const color = pct < 70 ? 'var(--accent)' : pct < 90 ? 'var(--amber)' : 'var(--alert)';
  const cls = `gauge${sm ? ' sm' : ''}${xs ? ' xs' : ''}`;
  return (
    <div
      className={cls}
      style={{ '--g-pct': `${Math.max(0, Math.min(100, pct))}%`, '--g-color': color }}
    />
  );
}

// ---------- Circular ring ----------

export function Spool({ pct }) {
  const R = 56;
  const stroke = 6;
  const C = 2 * Math.PI * R;
  const off = C * (1 - pct / 100);
  const tier = pct < 70 ? 'var(--accent)' : pct < 90 ? 'var(--amber)' : 'var(--alert)';
  return (
    <div className="drive-spool">
      <svg width="130" height="130" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={R} fill="none" stroke="var(--rule-soft)" strokeWidth={stroke} />
        <circle
          cx="65" cy="65" r={R}
          fill="none"
          stroke={tier}
          strokeWidth={stroke}
          strokeDasharray={C}
          strokeDashoffset={off}
          strokeLinecap="round"
          transform="rotate(-90 65 65)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="pct-text">{pct}<span className="sign">%</span></div>
    </div>
  );
}

// ---------- Phase order + Runway ----------

export const PHASE_ORDER = ['pending', 'add_to_cloud', 'staging', 'pinning', 'copying', 'done'];
export const PHASE_NAME = {
  pending: 'Pending',
  add_to_cloud: 'Add to cloud',
  staging: 'Staging',
  pinning: 'Pinning',
  copying: 'Copying',
  done: 'Done',
};

export function statusToPhaseIndex(status, phase) {
  if (status === 'idle') return -1;
  if (status === 'queued') return 0;
  if (status === 'paused') return phase === 'pinning' ? 3 : phase === 'copying' ? 4 : 2;
  if (status === 'completed') return 5;
  if (status === 'failed') return phase === 'copying' ? 4 : phase === 'pinning' ? 3 : 2;
  if (status === 'copying') return 4;
  if (status === 'downloading') {
    if (phase === 'pinning') return 3;
    if (phase === 'copying') return 4;
    return 2;
  }
  return -1;
}

export function Runway({ status, phase, failed }) {
  const idx = statusToPhaseIndex(status, phase);
  return (
    <div className="runway">
      {PHASE_ORDER.map((p, i) => {
        let cls = 'runway-step';
        if (failed && i === idx) cls += ' failed';
        else if (i < idx) cls += ' done';
        else if (i === idx) cls += ' active';
        return (
          <div key={p} className={cls}>
            <span className="num">{String(i + 1).padStart(2, '0')}</span>
            <span className="nm">{PHASE_NAME[p]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Lane progress bar ----------

export function Fuel({ pct, copying, failed }) {
  return (
    <div
      className={`fuel${copying ? ' copying' : ''}${failed ? ' failed' : ''}`}
      style={{ '--fuel-pct': `${Math.max(0, Math.min(100, pct))}%` }}
    />
  );
}

// ---------- Source badge ----------

export function Src({ link }) {
  const src = sourceFromLink(link);
  const lbl = sourceLabel(src);
  return <span className={`src ${src}`}>{lbl}</span>;
}

// ---------- Section heading ----------

export function SectionHead({ ch, title, right }) {
  return (
    <div className="section-head">
      <div className="left">
        {ch && <span className="ch">{ch}</span>}
        <h2>{title}</h2>
      </div>
      {right && <div className="right">{right}</div>}
    </div>
  );
}

// ---------- Empty state ----------

export function Empty({ title, sub }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{sub}</p>
    </div>
  );
}

// ---------- Panel wrapper ----------

export function Panel({ head, action, children, flush }) {
  return (
    <div className={`panel${flush ? ' flush' : ''}`}>
      {head && (
        <div className="panel-head">
          <div className="label bright">{head}</div>
          {action && <div className="h-actions">{action}</div>}
        </div>
      )}
      <div className={`panel-body${flush ? ' flush' : ''}`}>{children}</div>
    </div>
  );
}
