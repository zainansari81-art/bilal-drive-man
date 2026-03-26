import { formatTB, formatSize } from '../lib/format';

export default function DrivesList({ drives }) {
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

  const getTotalCouples = (d) => d.clients ? d.clients.reduce((s, c) => s + c.couples.length, 0) : 0;

  return (
    <div className="list-card">
      <div className="list-header">
        <div className="list-title">{'\u26C1'} All Drives</div>
        <span className="list-badge">{drives.length}</span>
      </div>
      <div>
        {sorted.map((d, i) => {
          const pct = d.total > 0 ? Math.round(d.used / d.total * 100) : 0;
          const pctCls = pct < 70 ? 'low' : pct < 90 ? 'mid' : 'high';
          const barColor = pct < 70 ? '#22c55e' : pct < 90 ? '#eab308' : '#ef4444';
          const couples = getTotalCouples(d);

          return (
            <div className="drive-row" key={i}>
              <div className={`drive-status-dot ${d.connected ? 'online' : 'offline'}`}></div>
              <div className="drive-name">
                {d.name}{' '}
                <span style={{ color: '#8c8ca1', fontWeight: 400, fontSize: 11 }}>
                  ({d.clients ? d.clients.length : 0} clients, {couples} couples)
                </span>
              </div>
              <div className="drive-usage">{formatTB(d.used)} / {formatTB(d.total)}</div>
              <div className={`drive-pct ${pctCls}`}>{pct}%</div>
              <div className="drive-minibar">
                <div className="drive-minibar-fill" style={{ width: `${pct}%`, background: barColor }}></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
