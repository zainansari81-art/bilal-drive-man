import { formatTB } from '../lib/format';

export default function StatCards({ drives }) {
  const totalStorage = drives.reduce((sum, d) => sum + d.total, 0);
  const totalUsed = drives.reduce((sum, d) => sum + d.used, 0);
  const connectedCount = drives.filter(d => d.connected).length;
  const totalClients = drives.reduce((sum, d) => sum + (d.clients ? d.clients.length : 0), 0);
  const totalCouples = drives.reduce((sum, d) => {
    return sum + (d.clients ? d.clients.reduce((s, c) => s + c.couples.length, 0) : 0);
  }, 0);
  const usedPct = totalStorage > 0 ? Math.round((totalUsed / totalStorage) * 100) : 0;

  return (
    <div className="stat-cards">
      <div className="stat-card accent">
        <div className="stat-card-top">
          <div className="stat-card-icon" style={{ background: '#f0fde0' }}>{'\uD83D\uDCBE'}</div>
          <div className="stat-card-arrow">{'\u2197'}</div>
        </div>
        <div className="stat-card-label">Total Storage</div>
        <div className="stat-card-value">{formatTB(totalStorage)}</div>
        <div className="stat-card-sub">Across all drives</div>
      </div>

      <div className="stat-card">
        <div className="stat-card-top">
          <div className="stat-card-icon" style={{ background: '#eff6ff' }}>{'\uD83D\uDCC8'}</div>
          <div className="stat-card-arrow">{'\u2197'}</div>
        </div>
        <div className="stat-card-label">Space Used</div>
        <div className="stat-card-value">{usedPct}%</div>
        <div className="stat-card-sub">{formatTB(totalUsed)} of {formatTB(totalStorage)}</div>
      </div>

      <div className="stat-card">
        <div className="stat-card-top">
          <div className="stat-card-icon" style={{ background: '#f0fdf4' }}>{'\uD83D\uDD0C'}</div>
          <div className="stat-card-arrow">{'\u2197'}</div>
        </div>
        <div className="stat-card-label">Connected</div>
        <div className="stat-card-value">
          {connectedCount} <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>of {drives.length}</span>
        </div>
        <div className="stat-card-sub">Drives online now</div>
      </div>

      <div className="stat-card">
        <div className="stat-card-top">
          <div className="stat-card-icon" style={{ background: '#fdf4ff' }}>{'\uD83D\uDC65'}</div>
          <div className="stat-card-arrow">{'\u2197'}</div>
        </div>
        <div className="stat-card-label">Total Clients</div>
        <div className="stat-card-value">{totalClients}</div>
        <div className="stat-card-sub">With {totalCouples} couples tracked</div>
      </div>
    </div>
  );
}
