import { useState, useEffect } from 'react';

const PAGES = [
  { id: 'dashboard',   glyph: '☰',  label: 'Dashboard' },
  { id: 'drives',      glyph: '⧉',  label: 'Drives' },
  { id: 'devices',     glyph: '▢',  label: 'Machines' },
  { id: 'downloading', glyph: '↓',  label: 'Transfers' },
  { id: 'search',      glyph: '⌕',  label: 'Search' },
  { id: 'history',     glyph: '⏱',  label: 'History' },
];

export default function Sidebar({ currentPage, onNavigate, projects }) {
  const activeCount = (projects || []).filter(
    p => ['downloading', 'copying'].includes(p.download_status)
  ).length;

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  };

  return (
    <aside className="rail">
      <div className="rail-logo">
        <div className="mark">B</div>
        <div className="brand">
          <div className="brand-name">Bilal Drive Man</div>
          <div className="brand-sub">TXB Studios</div>
        </div>
      </div>

      <div className="rail-divider" />

      <nav className="rail-nav">
        {PAGES.map(p => (
          <button
            key={p.id}
            className={`rail-item ${currentPage === p.id ? 'active' : ''}`}
            onClick={() => onNavigate(p.id)}
            title={p.label}
          >
            <span className="glyph">{p.glyph}</span>
            <span>{p.label}</span>
            {p.id === 'downloading' && activeCount > 0 && (
              <span className="badge-dot" />
            )}
          </button>
        ))}
      </nav>

      <div className="rail-foot">
        <div className="rail-divider" />
        <button
          className="rail-item"
          onClick={handleLogout}
          title="Log out"
        >
          <span className="glyph">↩</span>
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}
