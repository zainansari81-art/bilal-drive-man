import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatTB, formatSize } from '../lib/format';

const DEFAULT_VISIBLE = 5;

function DriveRow({ d, fullPage }) {
  const pct = d.total > 0 ? Math.round(d.used / d.total * 100) : 0;
  const pctCls = pct < 70 ? 'low' : pct < 90 ? 'mid' : 'high';
  const barColor = pct < 70 ? 'linear-gradient(135deg, #22c55e, #16a34a)' : pct < 90 ? 'linear-gradient(135deg, #eab308, #ca8a04)' : 'linear-gradient(135deg, #ef4444, #dc2626)';
  const totalClients = d.clients ? d.clients.length : 0;
  const totalCouples = d.clients ? d.clients.reduce((s, c) => s + c.couples.length, 0) : 0;

  return (
    <div className="drive-row">
      <div className={`drive-status-dot ${d.connected ? 'online' : 'offline'}`}></div>
      <div className="drive-name">
        {d.name}{' '}
        <span style={{ color: '#8c8ca1', fontWeight: 400, fontSize: 11 }}>
          ({totalClients} clients, {totalCouples} couples)
        </span>
        {fullPage && d.sourceMachine && (
          <span style={{ color: '#b0b0c0', fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
            on {d.sourceMachine}
          </span>
        )}
      </div>
      <div className="drive-usage">{formatTB(d.used)} / {formatTB(d.total)}</div>
      <div className={`drive-pct ${pctCls}`}>{pct}%</div>
      <div className="drive-minibar">
        <div className="drive-minibar-fill" style={{ width: `${pct}%`, background: barColor }}></div>
      </div>
    </div>
  );
}

export default function DrivesList({ drives }) {
  const [fullPage, setFullPage] = useState(false);

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

  if (!drives || drives.length === 0) {
    return (
      <div className="list-card">
        <div className="list-header">
          <div className="list-title">{'\u26C1'} All Drives</div>
          <span className="list-badge">0</span>
        </div>
        <div style={{ textAlign: 'center', padding: '30px 0', color: '#8c8ca1', fontSize: 13 }}>
          No drives connected yet
        </div>
      </div>
    );
  }

  const sorted = [...drives].sort((a, b) => b.connected - a.connected || a.name.localeCompare(b.name));
  const previewDrives = sorted.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = drives.length - DEFAULT_VISIBLE;

  const totalUsed = drives.reduce((s, d) => s + d.used, 0);
  const totalFree = drives.reduce((s, d) => s + d.free, 0);

  return (
    <>
      <div className="list-card">
        <div className="list-header">
          <div className="list-title">{'\u26C1'} All Drives</div>
          <span className="list-badge">{drives.length}</span>
        </div>
        <div>
          {previewDrives.map((d, i) => (
            <DriveRow key={i} d={d} fullPage={false} />
          ))}
        </div>
        {hiddenCount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px 4px' }}>
            <button className="chart-expand-btn" onClick={() => setFullPage(true)}>
              {'\u26F6'} View all {drives.length} drives
            </button>
          </div>
        )}
      </div>

      {fullPage && typeof document !== 'undefined' && createPortal(
        <div className="chart-fullpage-overlay" onClick={() => setFullPage(false)}>
          <div className="chart-fullpage-modal" onClick={(e) => e.stopPropagation()}>
            <div className="chart-fullpage-header">
              <div>
                <div className="list-title" style={{ fontSize: 16 }}>{'\u26C1'} All Drives</div>
                <div style={{ fontSize: 13, color: '#8c8ca1', marginTop: 2 }}>
                  {drives.length} drives &middot; {formatTB(totalUsed)} used &middot; {formatTB(totalFree)} free
                </div>
              </div>
              <button className="chart-fullpage-close" onClick={() => setFullPage(false)}>
                {'\u2715'}
              </button>
            </div>

            <div className="drives-fullpage-body">
              {sorted.map((d, i) => (
                <DriveRow key={i} d={d} fullPage={true} />
              ))}
            </div>

            <div style={{ padding: '12px 20px', fontSize: 12, color: '#b0b0c0', textAlign: 'right', borderTop: '1px solid #f0f2f5' }}>
              Press Esc to close
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
