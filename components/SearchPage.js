import { useState, useEffect, useRef, useMemo } from 'react';
import { LED, Empty, fmtBytes } from './atoms';

export default function SearchPage({ initialQuery, drives }) {
  const [query, setQuery] = useState(initialQuery || '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    setQuery(initialQuery || '');
  }, [initialQuery]);

  // Build couple index from drives passed in (fleet-wide from page-level state)
  const index = useMemo(() => {
    const rows = [];
    (drives || []).forEach(d => {
      (d.clients || []).forEach(c => {
        (c.couples || []).forEach(cp => {
          rows.push({
            couple: cp.name,
            client: c.name,
            drive: d.name,
            connected: d.connected,
            size: cp.size,
            machine: d.sourceMachine,
            letter: d.letter,
          });
        });
      });
    });
    return rows;
  }, [drives]);

  const results = query.trim()
    ? index.filter(r => {
        const needle = query.trim().toLowerCase();
        return (
          r.couple.toLowerCase().includes(needle) ||
          r.client.toLowerCase().includes(needle) ||
          r.drive.toLowerCase().includes(needle)
        );
      })
    : null;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title"><h1>Search</h1></div>
        <div className="page-sub">Type a couple, client, or drive — searches the full fleet.</div>
      </div>

      <div className="search-frame">
        <div className="label-cell">
          <span style={{ fontSize: 16, color: 'var(--ink-mute)' }}>⌕</span>
        </div>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search couples, clients, or drives…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <span style={{ fontSize: 12, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>
          {index.length.toLocaleString()} couples indexed
        </span>
        {query && (
          <button className="btn ghost sm" onClick={() => setQuery('')}>Clear</button>
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        {results === null && (
          <div className="empty">
            <p>Type a name above to search across all drives.</p>
          </div>
        )}

        {results !== null && results.length === 0 && (
          <Empty title="No matches" sub={`Nothing in the fleet matches "${query}".`} />
        )}

        {results !== null && results.length > 0 && (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 10 }}>
              {results.length} match{results.length !== 1 ? 'es' : ''} for &ldquo;{query}&rdquo;
            </div>
            <div className="panel flush">
              {results.map((r, i) => (
                <div className="result-row" key={i}>
                  <LED state={r.connected ? 'on' : 'off'} />
                  <div>
                    <div className="nm">{r.couple}</div>
                    <div className="meta">{r.client}</div>
                  </div>
                  <div className="t-mono" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                    {r.drive}
                    {r.letter && <span style={{ color: 'var(--ink-mute)' }}> · {r.letter}:\</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{r.machine}</div>
                  <div className="sz">{fmtBytes(r.size)}</div>
                  <div style={{
                    fontSize: 11.5, fontWeight: 500, textAlign: 'right',
                    color: r.connected ? 'var(--accent-fg)' : 'var(--ink-mute)',
                  }}>
                    {r.connected ? 'Online' : 'Offline'}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
