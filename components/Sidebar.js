import { useState, useEffect } from 'react';

export default function Sidebar({ currentPage, onNavigate, driveCount, onScan, username, collapsed, onToggleCollapse }) {
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
    { id: 'downloading', label: 'Downloading-Pro', icon: '\u2B07' },
    { id: 'search', label: 'Search', icon: '\u2315' },
    { id: 'history', label: 'History', icon: '\u29D6' },
  ];

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="logo">
        <div className="logo-circle">B</div>
        {!collapsed && (
          <div>
            <div className="logo-text">Bilal - Drive Man</div>
            <div className="logo-sub">by TXB</div>
          </div>
        )}
      </div>

      <button
        className="sidebar-toggle"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '\u276F' : '\u276E'}
      </button>

      <div className="sidebar-divider"></div>

      <div className="nav-items">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`nav-item${currentPage === item.id ? ' active' : ''}`}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? item.label : ''}
          >
            <span className="nav-icon">{item.icon}</span>
            {!collapsed && item.label}
            {!collapsed && item.badge && <span className="nav-badge">{item.badge}</span>}
          </button>
        ))}
      </div>

      <div className="sidebar-bottom">
        {!collapsed ? (
          <>
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
              className="sidebar-logout-btn"
            >
              <span style={{ fontSize: '16px' }}>{'\u2190'}</span>
              Logout{username ? ` (${username})` : ''}
            </button>
          </>
        ) : (
          <>
            <button
              className="nav-item"
              onClick={handleScan}
              disabled={scanning}
              title="Scan Drives"
              style={{ justifyContent: 'center' }}
            >
              <span className="nav-icon">{scanning ? '\u23F3' : '\u{1F50D}'}</span>
            </button>
            <button
              className="nav-item"
              onClick={handleLogout}
              title="Logout"
              style={{ justifyContent: 'center' }}
            >
              <span className="nav-icon">{'\u2190'}</span>
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
