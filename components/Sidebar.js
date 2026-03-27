import { useState } from 'react';

export default function Sidebar({ currentPage, onNavigate, driveCount, onScan, username }) {
  const [scanning, setScanning] = useState(false);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  const handleScan = async () => {
    setScanning(true);
    await onScan();
    setTimeout(() => setScanning(false), 1500);
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '\u25A6' },
    { id: 'drives', label: 'Drives', icon: '\u26C1', badge: driveCount },
    { id: 'devices', label: 'Devices', icon: '\uD83D\uDCBB' },
    { id: 'search', label: 'Search', icon: '\u2315' },
    { id: 'history', label: 'History', icon: '\u29D6' },
  ];

  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-circle">B</div>
        <div>
          <div className="logo-text">Bilal - Drive Man</div>
          <div className="logo-sub">by TXB</div>
        </div>
      </div>
      <div className="sidebar-divider"></div>

      <div className="nav-items">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`nav-item${currentPage === item.id ? ' active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
            {item.badge && <span className="nav-badge">{item.badge}</span>}
          </button>
        ))}
      </div>

      <div className="sidebar-bottom">
        <div className="scan-card">
          <h3>Scan Drives</h3>
          <p>Rescan all connected external drives</p>
          <button className="scan-btn" onClick={handleScan} disabled={scanning}>
            {scanning ? 'Scanning...' : 'Scan Now'}
          </button>
        </div>
        <div className="sidebar-brand">Powered by TXB</div>
        <button
          onClick={handleLogout}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            marginTop: '12px',
            padding: '10px 16px',
            background: 'none',
            border: '1px solid #e5e7eb',
            borderRadius: '10px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
            color: '#8c8ca1',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#f7f8fa'; e.currentTarget.style.color = '#4a4a6a'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#8c8ca1'; }}
        >
          <span style={{ fontSize: '16px' }}>{'\u2190'}</span>
          Logout{username ? ` (${username})` : ''}
        </button>
      </div>
    </aside>
  );
}
