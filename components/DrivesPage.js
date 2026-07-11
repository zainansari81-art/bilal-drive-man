import { useState, useEffect } from 'react';
import { LED, Gauge, Spool, Empty, fmtBytes, fmtTB, fmtPct } from './atoms';
import DeleteConfirmModal from './DeleteConfirmModal';
import FinderModal from './FinderModal';

// Mount point as the operator would see it on the machine itself.
// Mac drives sync a (truncated) /Volumes path into drive_letter; Windows
// drives sync "D:"-style letters.
function mountOf(d) {
  if (!d.letter) return '—';
  if (d.letter.includes('/')) return `/Volumes/${d.name}`;
  return d.letter.endsWith(':') ? `${d.letter}\\` : `${d.letter}:\\`;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DrivesPage({ drives }) {
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('fullness');
  const [hidden, setHidden] = useState(() => new Set());
  const [ignoredIds, setIgnoredIds] = useState(() => new Set());
  const [onlineMachines, setOnlineMachines] = useState(() => new Set());
  const [browseDrive, setBrowseDrive] = useState(null);
  // Time-relative strings only render after mount (SSR footgun #2 —
  // Date.now() during server render causes hydration mismatches).
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch('/api/devices');
        const data = await res.json();
        if (!stopped && Array.isArray(data)) {
          setOnlineMachines(new Set(data.filter(m => m.isOnline).map(m => m.name)));
        }
      } catch {
        // keep last known liveness on transient errors
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  const handleDeleted = ({ driveName, clientName, coupleName, type }) => {
    const key = type === 'client'
      ? `${driveName}|${clientName}|*`
      : `${driveName}|${clientName}|${coupleName}`;
    setHidden(prev => new Set([...prev, key]));
  };

  const handleIgnore = async (driveId, driveName) => {
    if (!driveId) return;
    if (!window.confirm(
      `Ignore "${driveName}" permanently?\n\nIt will be hidden from the dashboard. You can un-ignore via SQL if needed.`
    )) return;
    setIgnoredIds(prev => new Set([...prev, driveId]));
    try {
      const res = await fetch('/api/drives', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: driveId, is_ignored: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setIgnoredIds(prev => {
        const next = new Set(prev);
        next.delete(driveId);
        return next;
      });
      window.alert(`Failed to ignore drive: ${err.message}`);
    }
  };

  const visibleDrives = drives
    .filter(d => !ignoredIds.has(d.id))
    .map(d => ({
      ...d,
      clients: (d.clients || [])
        .filter(c => !hidden.has(`${d.name}|${c.name}|*`))
        .map(c => ({
          ...c,
          couples: (c.couples || []).filter(cp => !hidden.has(`${d.name}|${c.name}|${cp.name}`)),
        })),
    }));

  const filtered = visibleDrives.filter(d =>
    filter === 'all' ? true : filter === 'connected' ? d.connected : !d.connected
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'machine') return (a.sourceMachine || '').localeCompare(b.sourceMachine || '');
    const pa = a.total > 0 ? a.used / a.total : 0;
    const pb = b.total > 0 ? b.used / b.total : 0;
    if (pb !== pa) return pb - pa;
    return a.name.localeCompare(b.name);
  });

  const connCount = visibleDrives.filter(d => d.connected).length;
  const offCount = visibleDrives.length - connCount;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title">
          <h1>Drives</h1>
        </div>
        <div className="page-sub">
          External drives across the fleet. Sort by fullness to spot what needs swapping.
        </div>
      </div>

      {/* Filter / sort strip */}
      <div className="filter-strip" style={{ marginBottom: 22 }}>
        {[
          { id: 'all', label: 'All', count: visibleDrives.length },
          { id: 'connected', label: 'Connected', count: connCount },
          { id: 'disconnected', label: 'Offline', count: offCount },
        ].map(chip => (
          <div
            key={chip.id}
            className={`filter-chip ${filter === chip.id ? 'active' : ''}`}
            onClick={() => setFilter(chip.id)}
          >
            <span className="l">{chip.label}</span>
            <span className="v">{chip.count}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px',
          background: 'var(--panel)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--r)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Sort by</span>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            style={{ background: 'transparent', border: 0, color: 'var(--ink)', fontSize: 13, fontWeight: 500, outline: 0, cursor: 'pointer' }}
          >
            <option value="fullness">Fullness</option>
            <option value="name">Name</option>
            <option value="machine">Machine</option>
          </select>
        </div>
      </div>

      {sorted.length === 0 ? (
        <Empty title="No drives" sub="No drives match the current filter." />
      ) : (
        <div className="drives-grid stagger">
          {sorted.map(d => (
            <DriveCard
              key={d.id || d.name}
              drive={d}
              mounted={mounted}
              machineOnline={onlineMachines.has(d.sourceMachine)}
              onBrowse={() => setBrowseDrive(d)}
              onDeleted={handleDeleted}
              onIgnore={handleIgnore}
            />
          ))}
        </div>
      )}

      {browseDrive && (
        <FinderModal
          drives={visibleDrives}
          onlineMachines={onlineMachines}
          initialDrive={browseDrive}
          onClose={() => setBrowseDrive(null)}
        />
      )}
    </div>
  );
}

function DriveCard({ drive: d, mounted, machineOnline, onBrowse, onDeleted, onIgnore }) {
  const [open, setOpen] = useState(false);
  const pct = fmtPct(d.used, d.total);
  const clientsCount = (d.clients || []).length;
  const couplesCount = (d.clients || []).reduce((s, c) => s + c.couples.length, 0);
  const canBrowse = d.connected && machineOnline;
  const browseHint = canBrowse
    ? `Open ${d.name} in the browser (live from ${d.sourceMachine})`
    : !d.connected
      ? 'Drive is not connected to any machine'
      : `${d.sourceMachine || 'Machine'} is not live right now`;

  return (
    <div className={`drive-card${!d.connected ? ' dim' : ''}`}>
      <div className="drive-card-top">
        <div>
          <div className="nm">{d.name}</div>
          <div className="machine">{d.sourceMachine}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <LED state={d.connected ? 'on' : 'off'} />
          <span style={{ fontSize: 11.5, color: d.connected ? 'var(--accent-fg)' : 'var(--ink-mute)', fontWeight: 500 }}>
            {d.connected ? mountOf(d) : 'Offline'}
          </span>
        </div>
      </div>

      <Spool pct={pct} />

      <div className="row-detail">
        <span className="l">Used</span>
        <span className="v">{fmtTB(d.used)} TB</span>
      </div>
      <div className="row-detail">
        <span className="l">Free</span>
        <span className="v">{fmtTB(d.free)} TB</span>
      </div>
      <div className="row-detail">
        <span className="l">Capacity</span>
        <span className="v">{fmtTB(d.total)} TB</span>
      </div>
      <div className="row-detail">
        <span className="l">Machine</span>
        <span className="v" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {d.sourceMachine || '—'}
          {d.sourceMachine && <LED state={machineOnline ? 'on' : 'off'} />}
        </span>
      </div>
      <div className="row-detail">
        <span className="l">Last scan</span>
        <span className="v">{mounted ? timeAgo(d.lastScan) : '—'}</span>
      </div>
      <div className="row-detail">
        <span className="l">Last seen</span>
        <span className="v">{mounted ? timeAgo(d.lastSeen) : '—'}</span>
      </div>

      <div className="drive-card-foot">
        <div className="stats">
          <strong>{clientsCount}</strong> clients · <strong>{couplesCount}</strong> couples
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {onIgnore && (
            <button
              className="btn ghost sm"
              onClick={e => { e.stopPropagation(); onIgnore(d.id, d.name); }}
              title="Hide this drive permanently"
              style={{ color: 'var(--ink-mute)', fontSize: 11 }}
            >
              Ignore
            </button>
          )}
          <button className="btn ghost sm" onClick={() => setOpen(!open)}>
            {open ? 'Collapse' : 'Inspect →'}
          </button>
          <button
            className="drive-browse-btn"
            disabled={!canBrowse}
            onClick={onBrowse}
            title={browseHint}
          >
            Browse ⌘
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--rule-soft)' }}>
          {(d.clients || []).length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', padding: '8px 0' }}>No clients on this drive.</div>
          ) : (
            (d.clients || []).map((c, ci) => (
              <ClientBlock key={ci} client={c} drive={d} onDeleted={onDeleted} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ClientBlock({ client, drive, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const clientTotal = (client.couples || []).reduce((s, cp) => s + (cp.size || 0), 0);

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 500, marginBottom: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        onClick={() => setOpen(!open)}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{client.name}</span>
        <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>({(client.couples || []).length} couples · {fmtBytes(clientTotal)})</span>
        {drive.connected && (
          <button
            className="btn ghost sm"
            style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--alert-fg)' }}
            onClick={e => {
              e.stopPropagation();
              setDeleteTarget({
                type: 'client',
                driveName: drive.name,
                clientName: client.name,
                coupleName: '',
                size: clientTotal,
                coupleCount: (client.couples || []).length,
                sourceMachine: drive.sourceMachine,
              });
            }}
          >
            Delete client
          </button>
        )}
      </div>
      {open && (client.couples || []).map((cp, cpi) => (
        <div
          key={cpi}
          className="row between"
          style={{ padding: '4px 0 4px 18px', borderBottom: '1px solid var(--rule-soft)', alignItems: 'center' }}
        >
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{cp.name}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="t-mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>{fmtBytes(cp.size)}</span>
            {drive.connected && (
              <button
                className="btn ghost sm"
                style={{ fontSize: 11, color: 'var(--alert-fg)' }}
                onClick={() => setDeleteTarget({
                  type: 'couple',
                  driveName: drive.name,
                  clientName: client.name,
                  coupleName: cp.name,
                  size: cp.size || 0,
                  sourceMachine: drive.sourceMachine,
                })}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
      {deleteTarget && (
        <DeleteConfirmModal
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}
