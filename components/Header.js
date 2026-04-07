import { useState } from 'react';

const pageTitles = {
  dashboard: 'Dashboard',
  drives: 'Drives',
  devices: 'Devices',
  search: 'Search Couples',
  history: 'History',
};

export default function Header({ currentPage, onNavigate, onQuickSearch, refreshCountdown, refreshInterval = 300, lastRefreshed, onRefreshNow }) {
  const [query, setQuery] = useState('');

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && query.trim()) {
      onQuickSearch(query.trim());
      onNavigate('search');
    }
  };

  const formatCountdown = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  };

  return (
    <div className="header">
      <h1>{pageTitles[currentPage] || 'Dashboard'}</h1>
      <div className="header-right">
        <div className="search-box">
          <span className="search-icon">{'\u2315'}</span>
          <input
            type="text"
            placeholder="Search couple name..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="refresh-timer" onClick={onRefreshNow} title="Click to refresh now">
          <svg className="refresh-ring" width="28" height="28" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="12" fill="none" stroke="#e5e7eb" strokeWidth="2.5" />
            <circle
              cx="14" cy="14" r="12" fill="none"
              stroke="#c8e600" strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 12}`}
              strokeDashoffset={`${2 * Math.PI * 12 * (1 - (refreshCountdown || 0) / refreshInterval)}`}
              style={{ transition: 'stroke-dashoffset 1s linear', transform: 'rotate(-90deg)', transformOrigin: 'center' }}
            />
          </svg>
          <span className="refresh-seconds">{formatCountdown(refreshCountdown || 0)}</span>
          <span className="refresh-label">Refresh</span>
        </div>
        <div className="status-indicator">
          <div className="status-dot"></div>
          Live
        </div>
        <div className="user-avatar">B</div>
      </div>
    </div>
  );
}
