export default function DonutChart({ drives }) {
  const total = drives.length;
  const connected = drives.filter(d => d.connected).length;
  const disconnected = total - connected;
  const lowSpace = drives.filter(d => d.free < 500).length;

  const connPct = total > 0 ? Math.round((connected / total) * 100) : 0;
  const discPct = total > 0 ? Math.round((disconnected / total) * 100) : 0;
  const lowPct = total > 0 ? Math.round((lowSpace / total) * 100) : 0;

  // SVG donut math
  const r = 65;
  const circumference = 2 * Math.PI * r;
  const connArc = (connected / total) * circumference;
  const discArc = (disconnected / total) * circumference;

  return (
    <div className="chart-card">
      <div className="chart-header">
        <div className="chart-title">{'\u25CF'} Drive Status</div>
        <div className="chart-subtitle">Overview</div>
      </div>

      <div className="donut-container">
        <div className="donut-wrapper">
          <svg className="donut-svg" viewBox="0 0 180 180">
            <circle cx="90" cy="90" r={r} fill="none" stroke="#e5e7eb" strokeWidth="22" />
            <circle
              cx="90" cy="90" r={r} fill="none" stroke="#c8e600" strokeWidth="22"
              strokeDasharray={`${connArc} ${circumference - connArc}`}
              strokeDashoffset={circumference * 0.25}
              strokeLinecap="round"
            />
            <circle
              cx="90" cy="90" r={r} fill="none" stroke="#93c5fd" strokeWidth="22"
              strokeDasharray={`${discArc} ${circumference - discArc}`}
              strokeDashoffset={circumference * 0.25 - connArc}
              strokeLinecap="round"
            />
          </svg>
          <div className="donut-center">
            <div className="donut-center-value">{total}</div>
            <div className="donut-center-label">Total</div>
          </div>
        </div>

        <div className="donut-stats">
          <div className="donut-stat-row">
            <div className="donut-stat-left">
              <div className="donut-stat-dot" style={{ background: '#c8e600' }}></div>
              <span className="donut-stat-label">Connected</span>
            </div>
            <span className="donut-stat-value">{connPct}%</span>
          </div>
          <div className="donut-progress">
            <div className="donut-progress-fill" style={{ width: `${connPct}%`, background: '#c8e600' }}></div>
          </div>

          <div className="donut-stat-row">
            <div className="donut-stat-left">
              <div className="donut-stat-dot" style={{ background: '#93c5fd' }}></div>
              <span className="donut-stat-label">Disconnected</span>
            </div>
            <span className="donut-stat-value">{discPct}%</span>
          </div>
          <div className="donut-progress">
            <div className="donut-progress-fill" style={{ width: `${discPct}%`, background: '#93c5fd' }}></div>
          </div>

          <div className="donut-stat-row">
            <div className="donut-stat-left">
              <div className="donut-stat-dot" style={{ background: '#f97316' }}></div>
              <span className="donut-stat-label">Low Space</span>
            </div>
            <span className="donut-stat-value">{lowPct}%</span>
          </div>
          <div className="donut-progress">
            <div className="donut-progress-fill" style={{ width: `${lowPct}%`, background: '#f97316' }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}
