import { useState } from 'react';
import { formatTB } from '../lib/format';

export default function BarChart({ drives }) {
  const [hoveredDrive, setHoveredDrive] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const totalUsed = drives.reduce((s, d) => s + d.used, 0);
  const totalFree = drives.reduce((s, d) => s + d.free, 0);

  const DEFAULT_VISIBLE = 8;
  const sorted = [...drives].sort((a, b) => (b.total || 0) - (a.total || 0));

  // When collapsed show top 8, when expanded show all
  const displayDrives = expanded ? sorted : sorted.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = drives.length - DEFAULT_VISIBLE;

  const maxDriveBytes = displayDrives.length > 0 ? Math.max(...displayDrives.map(d => d.total || 0)) : 4e12;
  const maxBytes = Math.ceil(maxDriveBytes / 1e12) * 1e12 || 4e12;
  const steps = 4;
  const chartHeight = 170;

  // When expanded with many drives, use a wider scrollable area
  const needsScroll = expanded && displayDrives.length > 10;

  return (
    <div className="chart-card">
      <div className="chart-header">
        <div className="chart-title">{'\u2587'} Drive Space Usage</div>
        <div className="chart-subtitle">{drives.length} drive{drives.length !== 1 ? 's' : ''}</div>
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
        <div className={`bar-chart-scroll-wrapper ${needsScroll ? 'scrollable' : ''}`}>
          <div className="bar-chart" style={needsScroll ? { minWidth: displayDrives.length * 70 } : undefined}>
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
              {displayDrives.map((d, i) => {
                const usedH = maxBytes > 0 ? (d.used / maxBytes) * chartHeight : 0;
                const freeH = maxBytes > 0 ? (d.free / maxBytes) * chartHeight : 0;
                const pct = d.total > 0 ? Math.round(d.used / d.total * 100) : 0;
                const isHovered = hoveredDrive === i;
                return (
                  <div
                    className="bar-group"
                    key={i}
                    onMouseEnter={() => setHoveredDrive(i)}
                    onMouseLeave={() => setHoveredDrive(null)}
                  >
                    {isHovered && (
                      <div className="bar-hover-card">
                        <div className="bar-hover-name">{d.name}</div>
                        <div className="bar-hover-row"><span className="bar-hover-dot used"></span>{formatTB(d.used)} used</div>
                        <div className="bar-hover-row"><span className="bar-hover-dot free"></span>{formatTB(d.free)} free</div>
                        <div className="bar-hover-pct">{pct}% full</div>
                      </div>
                    )}
                    <div className="bar used" style={{ height: usedH }}></div>
                    <div className="bar free" style={{ height: freeH }}></div>
                    <div className="bar-label">
                      {d.name && d.name.length > 10 ? d.name.slice(0, 9) + '\u2026' : d.name}
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
        </div>
      )}

      <div className="chart-bottom-row">
        <div className="chart-legend">
          <div className="legend-item">
            <div className="legend-dot" style={{ background: '#c8e600' }}></div> Used
          </div>
          <div className="legend-item">
            <div className="legend-dot" style={{ background: '#93c5fd' }}></div> Free
          </div>
        </div>

        {hiddenCount > 0 && (
          <button className="chart-expand-btn" onClick={() => setExpanded(!expanded)}>
            {expanded ? '\u25B2 Show less' : `\u25BC Show all ${drives.length} drives`}
          </button>
        )}
      </div>
    </div>
  );
}
