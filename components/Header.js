import { useState } from 'react';

const pageTitles = {
  dashboard: 'Dashboard',
  drives: 'Drives',
  devices: 'Devices',
  search: 'Search Couples',
  history: 'History',
};

export default function Header({ currentPage, onNavigate, onQuickSearch, refreshCountdown, lastRefreshed, onRefreshNow }) {
  const [query, setQuery] = useState('');

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && query.trim()) {
      onQuickSearch(query.trim());
      onNavigate('search');
    }
  };

  const formatLastRefreshed = () => {
    if (!lastRefreshed) return '';
    const now = new Date();
    const diffSec = Math.floor((now - lastRefreshed) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    return `${Math.floor(diffSec / 60)}m ago`;
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
              strokeDashoffset={`${2 * Math.PI * 12 * (1 - (refreshCountdown || 0) / 30)}`}
              style={{ transition: 'stroke-dashoffset 1s linear', transform: 'rotate(-90deg)', transformOrigin: 'center' }}
            />
          </svg>
          <span className="refresh-seconds">{refreshCountdown || 0}s</span>
          {lastRefreshed && <span className="refresh-last">Updated {formatLastRefreshed()}</span>}
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
