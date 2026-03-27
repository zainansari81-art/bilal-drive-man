import { formatTB } from '../lib/format';

export default function BarChart({ drives }) {
  const maxDriveBytes = drives.length > 0 ? Math.max(...drives.map(d => d.total || 0)) : 4e12;
  const maxBytes = Math.ceil(maxDriveBytes / 1e12) * 1e12 || 4e12; // Round up to nearest TB, fallback 4TB
  const totalUsed = drives.reduce((s, d) => s + d.used, 0);
  const totalFree = drives.reduce((s, d) => s + d.free, 0);
  const steps = 4;

  return (
    <div className="chart-card">
      <div className="chart-header">
        <div className="chart-title">{'\u2587'} Drive Space Usage</div>
        <div className="chart-subtitle">Used vs Free</div>
      </div>

      <div className="chart-stats">
        <div>
          <div className="chart-stat-label">Total Used</div>
          <div className="chart-stat-value">{formatTB(totalUsed)}</div>
        </div>
        <div>
          <div className="chart-stat-label">Total Free</div>
          <div className="chart-stat-value">{formatTB(totalFree)}</div>
        </div>
      </div>

      {drives.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#8c8ca1', fontSize: 13 }}>
          No drives to display
        </div>
      ) : (
        <div className="bar-chart">
          <div className="bar-chart-y-axis">
            {Array.from({ length: steps + 1 }, (_, i) => {
              const val = maxBytes - (maxBytes / steps) * i;
              return <div className="bar-chart-y-label" key={i}>{val === 0 ? '0' : formatTB(val)}</div>;
            })}
          </div>
          <div className="bar-chart-area">
            <div className="bar-chart-gridlines">
              {Array.from({ length: steps + 1 }, (_, i) => (
                <div className="bar-chart-gridline" key={i}></div>
              ))}
            </div>
            {drives.map((d, i) => {
              const usedH = maxBytes > 0 ? (d.used / maxBytes) * 170 : 0;
              const freeH = maxBytes > 0 ? (d.free / maxBytes) * 170 : 0;
              return (
                <div className="bar-group" key={i}>
                  <div className="bar used" style={{ height: usedH }}>
                    <div className="bar-tooltip">{formatTB(d.used)} Used</div>
                  </div>
                  <div className="bar free" style={{ height: freeH }}>
                    <div className="bar-tooltip">{formatTB(d.free)} Free</div>
                  </div>
                  <div className="bar-label">
                    {d.name}
                    <span style={{
                      display: 'block', width: 6, height: 6, borderRadius: '50%',
                      background: d.connected ? '#22c55e' : '#ef4444', margin: '4px auto 0'
                    }}></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="chart-legend">
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#c8e600' }}></div> Used
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#93c5fd' }}></div> Free
        </div>
      </div>
    </div>
  );
}
