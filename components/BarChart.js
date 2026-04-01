import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatTB } from '../lib/format';

function ChartContent({ drives, maxBytes, steps, chartHeight, hoveredDrive, setHoveredDrive, fullPage }) {
  return (
    <div className="bar-chart" style={fullPage ? { height: chartHeight + 40 } : undefined}>
      <div className="bar-chart-y-axis" style={fullPage ? { bottom: 40 } : undefined}>
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
                {fullPage
                  ? (d.name && d.name.length > 14 ? d.name.slice(0, 13) + '\u2026' : d.name)
                  : (d.name && d.name.length > 10 ? d.name.slice(0, 9) + '\u2026' : d.name)
                }
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
  );
}

export default function BarChart({ drives }) {
  const [hoveredDrive, setHoveredDrive] = useState(null);
  const [hoveredDriveFull, setHoveredDriveFull] = useState(null);
  const [fullPage, setFullPage] = useState(false);
  const totalUsed = drives.reduce((s, d) => s + d.used, 0);
  const totalFree = drives.reduce((s, d) => s + d.free, 0);

  const DEFAULT_VISIBLE = 6;
  const sorted = [...drives].sort((a, b) => (b.total || 0) - (a.total || 0));
  const previewDrives = sorted.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = drives.length - DEFAULT_VISIBLE;

  const previewMax = previewDrives.length > 0 ? Math.max(...previewDrives.map(d => d.total || 0)) : 4e12;
  const previewMaxBytes = Math.ceil(previewMax / 1e12) * 1e12 || 4e12;

  const fullMax = sorted.length > 0 ? Math.max(...sorted.map(d => d.total || 0)) : 4e12;
  const fullMaxBytes = Math.ceil(fullMax / 1e12) * 1e12 || 4e12;

  const steps = 4;

  // Close on Escape
  useEffect(() => {
    if (!fullPage) return;
    const handleKey = (e) => { if (e.key === 'Escape') setFullPage(false); };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [fullPage]);

  return (
    <>
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
          <ChartContent
            drives={previewDrives}
            maxBytes={previewMaxBytes}
            steps={steps}
            chartHeight={170}
            hoveredDrive={hoveredDrive}
            setHoveredDrive={setHoveredDrive}
            fullPage={false}
          />
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
            <button className="chart-expand-btn" onClick={() => setFullPage(true)}>
              {'\u26F6'} View all {drives.length} drives
            </button>
          )}
        </div>
      </div>

      {/* Full-page overlay rendered via portal to escape overflow:hidden */}
      {fullPage && typeof document !== 'undefined' && createPortal(
        <div className="chart-fullpage-overlay" onClick={() => setFullPage(false)}>
          <div className="chart-fullpage-modal" onClick={(e) => e.stopPropagation()}>
            <div className="chart-fullpage-header">
              <div>
                <div className="chart-title">{'\u2587'} Drive Space Usage</div>
                <div style={{ fontSize: 13, color: '#8c8ca1', marginTop: 2 }}>
                  {drives.length} drives &middot; {formatTB(totalUsed)} used &middot; {formatTB(totalFree)} free
                </div>
              </div>
              <button className="chart-fullpage-close" onClick={() => setFullPage(false)}>
                {'\u2715'}
              </button>
            </div>

            <div className="chart-fullpage-body">
              <ChartContent
                drives={sorted}
                maxBytes={fullMaxBytes}
                steps={steps}
                chartHeight={Math.max(250, Math.min(450, window.innerHeight - 200))}
                hoveredDrive={hoveredDriveFull}
                setHoveredDrive={setHoveredDriveFull}
                fullPage={true}
              />
            </div>

            <div className="chart-legend" style={{ padding: '16px 20px 0 60px' }}>
              <div className="legend-item">
                <div className="legend-dot" style={{ background: '#c8e600' }}></div> Used
              </div>
              <div className="legend-item">
                <div className="legend-dot" style={{ background: '#93c5fd' }}></div> Free
              </div>
              <div className="legend-item" style={{ marginLeft: 'auto', fontSize: 12, color: '#b0b0c0' }}>
                Press Esc to close
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
