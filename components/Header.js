import { useState } from 'react';

const pageTitles = {
  dashboard: 'Dashboard',
  drives: 'Drives',
  devices: 'Devices',
  search: 'Search Couples',
  history: 'History',
};

export default function Header({ currentPage, onNavigate, onQuickSearch }) {
  const [query, setQuery] = useState('');

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && query.trim()) {
      onQuickSearch(query.trim());
      onNavigate('search');
    }
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
        <div className="status-indicator">
          <div className="status-dot"></div>
          Monitoring
        </div>
        <div className="user-avatar">B</div>
      </div>
    </div>
  );
}
