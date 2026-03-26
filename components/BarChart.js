export default function BarChart({ drives }) {
  const maxGB = 4000;
  const totalUsed = drives.reduce((s, d) => s + d.used, 0);
  const totalFree = drives.reduce((s, d) => s + d.free, 0);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <div className="chart-title">{'\u2587'} Drive Space Usage</div>
        <div className="chart-subtitle">Used vs Free</div>
      </div>

      <div className="chart-stats">
        <div>
          <div className="chart-stat-label">Total Used</div>
          <div className="chart-stat-value">{(totalUsed / 1000).toFixed(1)} TB</div>
          <div className="chart-stat-change up">{'\u2197'} 12% vs last month</div>
        </div>
        <div>
          <div className="chart-stat-label">Total Free</div>
          <div className="chart-stat-value">{(totalFree / 1000).toFixed(1)} TB</div>
          <div className="chart-stat-change down">{'\u2198'} 8% vs last month</div>
        </div>
      </div>

      <div className="bar-chart">
        <div className="bar-chart-y-axis">
          <div className="bar-chart-y-label">4 TB</div>
          <div className="bar-chart-y-label">3 TB</div>
          <div className="bar-chart-y-label">2 TB</div>
          <div className="bar-chart-y-label">1 TB</div>
          <div className="bar-chart-y-label">0</div>
        </div>
        <div className="bar-chart-area">
          <div className="bar-chart-gridlines">
            <div className="bar-chart-gridline"></div>
            <div className="bar-chart-gridline"></div>
            <div className="bar-chart-gridline"></div>
            <div className="bar-chart-gridline"></div>
            <div className="bar-chart-gridline"></div>
          </div>
          {drives.map((d, i) => {
            const usedH = (d.used / maxGB) * 170;
            const freeH = (d.free / maxGB) * 170;
            return (
              <div className="bar-group" key={i}>
                <div className="bar used" style={{ height: usedH }}>
                  <div className="bar-tooltip">{(d.used / 1000).toFixed(1)} TB Used</div>
                </div>
                <div className="bar free" style={{ height: freeH }}>
                  <div className="bar-tooltip">{(d.free / 1000).toFixed(1)} TB Free</div>
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
