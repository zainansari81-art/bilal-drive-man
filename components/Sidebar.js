import { useState } from 'react';

export default function Sidebar({ currentPage, onNavigate, driveCount, onScan }) {
  const [scanning, setScanning] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    await onScan();
    setTimeout(() => setScanning(false), 1500);
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '\u25A6' },
    { id: 'drives', label: 'Drives', icon: '\u26C1', badge: driveCount },
    { id: 'search', label: 'Search', icon: '\u2315' },
    { id: 'history', label: 'History', icon: '\u29D6', badge: 12 },
  ];

  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-circle">B</div>
        <div className="logo-text">Bilal - Drive Man</div>
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
      </div>
    </aside>
  );
}
