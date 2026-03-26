import { useState, useEffect, useRef } from 'react';
import { formatSize } from '../lib/format';

export default function SearchPage({ initialQuery }) {
  const [query, setQuery] = useState(initialQuery || '');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      doSearch(initialQuery);
    }
  }, [initialQuery]);

  const doSearch = async (q) => {
    const searchQuery = q || query;
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    }
    setSearching(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') doSearch();
  };

  return (
    <div>
      <div className="search-bar-large">
        <span style={{ fontSize: 20, color: '#b0b0c0' }}>{'\u2315'}</span>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search by client or couple name across all drives..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button onClick={() => doSearch()} disabled={searching}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>

      <div>
        {results === null && (
          <p style={{ color: '#8c8ca1', textAlign: 'center', padding: '40px 0', fontSize: 14 }}>
            Type a client or couple name and press Enter to search across all drives
          </p>
        )}

        {results !== null && results.length === 0 && (
          <p style={{ color: '#8c8ca1', textAlign: 'center', padding: '40px 0' }}>
            No results found for &quot;{query}&quot;
          </p>
        )}

        {results !== null && results.length > 0 && (
          <>
            <p style={{ fontWeight: 700, marginBottom: 12 }}>
              Found {results.length} result(s) for &quot;{query}&quot;
            </p>
            {results.map((r, i) => (
              <div className="result-card" key={i}>
                <div>
                  <div className="result-name">{r.couple}</div>
                  <div className="result-meta">
                    Client: <strong>{r.client}</strong> &nbsp;|&nbsp; Drive: <strong>{r.drive}</strong> &nbsp;|&nbsp; Size: {formatSize(r.size)}
                  </div>
                </div>
                <div className={`result-status ${r.connected ? 'connected' : 'disconnected'}`}>
                  {r.connected ? 'On Drive (Connected)' : 'On Drive (Disconnected)'}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
