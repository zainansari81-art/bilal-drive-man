import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { formatSize } from '../lib/format';
import { LED } from './atoms';

// Finder-style live browser for connected drives. Listings come from the
// scanner on the drive's machine via /api/fs-browse (command round-trip
// through download_commands), so the first visit to a folder takes one
// scanner poll cycle (~10s). Visited folders are cached for the lifetime
// of the window; Refresh forces a re-request.

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90000;

// ─── Kind / icon helpers ─────────────────────────────────────────────────────

const EXT_KINDS = {
  jpg: 'Image', jpeg: 'Image', png: 'Image', gif: 'Image', bmp: 'Image',
  heic: 'Image', heif: 'Image', tif: 'Image', tiff: 'Image', webp: 'Image',
  psd: 'Image', svg: 'Image',
  cr2: 'RAW Image', cr3: 'RAW Image', nef: 'RAW Image', arw: 'RAW Image',
  dng: 'RAW Image', raf: 'RAW Image', orf: 'RAW Image', rw2: 'RAW Image',
  mp4: 'Video', mov: 'Video', avi: 'Video', mkv: 'Video', m4v: 'Video',
  mts: 'Video', m2ts: 'Video', mxf: 'Video', braw: 'Video', r3d: 'Video',
  wmv: 'Video', webm: 'Video',
  mp3: 'Audio', wav: 'Audio', aac: 'Audio', flac: 'Audio', m4a: 'Audio',
  aif: 'Audio', aiff: 'Audio', ogg: 'Audio',
  zip: 'Archive', rar: 'Archive', '7z': 'Archive', tar: 'Archive',
  gz: 'Archive', dmg: 'Archive', iso: 'Archive',
  pdf: 'PDF', doc: 'Document', docx: 'Document', txt: 'Document',
  rtf: 'Document', xls: 'Spreadsheet', xlsx: 'Spreadsheet', csv: 'Spreadsheet',
  ppt: 'Presentation', pptx: 'Presentation',
  fcpbundle: 'Final Cut Library', fcpxml: 'Final Cut XML',
  prproj: 'Premiere Project', aep: 'After Effects', drp: 'Resolve Project',
  exe: 'Application', app: 'Application', bat: 'Application',
};

const KIND_COLORS = {
  'Image': '#8B5CF6', 'RAW Image': '#8B5CF6',
  'Video': '#0EA5E9',
  'Audio': '#D97706',
  'Archive': '#71717A',
  'PDF': '#DC2626',
  'Document': '#0EA5E9', 'Spreadsheet': '#4D7C0F', 'Presentation': '#D97706',
  'Final Cut Library': '#8B5CF6', 'Final Cut XML': '#8B5CF6',
  'Premiere Project': '#8B5CF6', 'After Effects': '#8B5CF6', 'Resolve Project': '#8B5CF6',
  'Application': '#3F3F46',
};

function extOf(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

function kindOf(entry) {
  if (entry.is_dir) return 'Folder';
  const ext = extOf(entry.name);
  if (EXT_KINDS[ext]) return EXT_KINDS[ext];
  return ext ? `${ext.toUpperCase()} File` : 'Document';
}

function FolderIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.5 6.2c0-1 .8-1.7 1.7-1.7h4.6c.5 0 1 .2 1.3.6l1 1.2c.3.4.8.6 1.3.6h7.4c1 0 1.7.8 1.7 1.7v9c0 1-.8 1.7-1.7 1.7H4.2c-1 0-1.7-.8-1.7-1.7V6.2Z" fill="#60A5FA"/>
      <path d="M2.5 9h19v8.6c0 1-.8 1.7-1.7 1.7H4.2c-1 0-1.7-.8-1.7-1.7V9Z" fill="#93C5FD"/>
    </svg>
  );
}

function FileIcon({ entry, size = 18 }) {
  const kind = kindOf(entry);
  const color = KIND_COLORS[kind] || '#A1A1AA';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 3.5c0-.8.7-1.5 1.5-1.5H14l5 5v13.5c0 .8-.7 1.5-1.5 1.5h-11c-.8 0-1.5-.7-1.5-1.5v-17Z" fill="#fff" stroke="#D4D4D8" strokeWidth="1.2"/>
      <path d="M14 2l5 5h-4.2c-.5 0-.8-.4-.8-.8V2Z" fill="#E4E4E7"/>
      <rect x="7.2" y="14.5" width="9.6" height="3.4" rx="1.2" fill={color} opacity="0.85"/>
    </svg>
  );
}

function DriveGlyph({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="7" width="19" height="10" rx="2.4" fill="#A1A1AA"/>
      <rect x="2.5" y="7" width="19" height="5.4" rx="2.4" fill="#71717A"/>
      <circle cx="17.8" cy="14.2" r="1.2" fill="#F4F4F5"/>
    </svg>
  );
}

function fmtDate(mtimeSec) {
  if (!mtimeSec) return '—';
  const d = new Date(mtimeSec * 1000);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function FinderModal({ drives, onlineMachines, initialDrive, onClose }) {
  const [drive, setDrive] = useState(initialDrive);
  const [path, setPath] = useState([]); // array of folder names from drive root
  const [listing, setListing] = useState(null); // { entries, total_items, truncated }
  const [loading, setLoading] = useState(null); // { stage: 'queued'|'listing', elapsed }
  const [error, setError] = useState(null);
  const [view, setView] = useState('list'); // 'list' | 'icons'
  const [sortKey, setSortKey] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState(null);
  const [histBack, setHistBack] = useState([]);
  const [histFwd, setHistFwd] = useState([]);

  const cacheRef = useRef(new Map());
  const seqRef = useRef(0); // invalidates in-flight polls after navigation
  const timerRef = useRef(null);

  const cacheKey = (d, p) => `${d.sourceMachine}|${d.name}|${p.join('/')}`;

  const loadDir = useCallback(async (d, p, { force = false } = {}) => {
    const seq = ++seqRef.current;
    if (timerRef.current) clearTimeout(timerRef.current);
    setSelected(null);
    setError(null);

    const key = cacheKey(d, p);
    if (!force && cacheRef.current.has(key)) {
      setListing(cacheRef.current.get(key));
      setLoading(null);
      return;
    }

    setListing(null);
    setLoading({ stage: 'queued', elapsed: 0 });

    let cmdId;
    try {
      const res = await fetch('/api/fs-browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_name: d.sourceMachine,
          drive_label: d.name,
          path: p.join('/'),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      cmdId = data.id;
      if (!cmdId) throw new Error('No command id returned');
    } catch (err) {
      if (seq !== seqRef.current) return;
      setLoading(null);
      setError(err.message);
      return;
    }

    const startedAt = Date.now();
    const poll = async () => {
      if (seq !== seqRef.current) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed > POLL_TIMEOUT_MS) {
        setLoading(null);
        setError(`No response from ${d.sourceMachine} after ${Math.round(POLL_TIMEOUT_MS / 1000)}s. The scanner may be busy or offline.`);
        return;
      }
      try {
        const res = await fetch(`/api/fs-browse?id=${encodeURIComponent(cmdId)}`);
        const data = await res.json();
        if (seq !== seqRef.current) return;
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        if (data.status === 'completed' && data.result) {
          cacheRef.current.set(key, data.result);
          setListing(data.result);
          setLoading(null);
          return;
        }
        if (data.status === 'completed' && !data.result) {
          // Pre-browse scanners ack unknown commands as completed with no
          // result — the machine needs a scanner update before it can browse.
          setLoading(null);
          setError(`The scanner on ${d.sourceMachine} doesn't support browsing yet — it needs a scanner update.`);
          return;
        }
        if (data.status === 'failed') {
          setLoading(null);
          setError(data.error || 'The scanner could not list this folder.');
          return;
        }
        setLoading({ stage: data.status === 'acked' ? 'listing' : 'queued', elapsed });
      } catch (err) {
        if (seq !== seqRef.current) return;
        // transient poll errors: keep trying until the timeout
        setLoading(prev => prev || { stage: 'queued', elapsed });
      }
      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    };
    timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
  }, []);

  // Initial load + cleanup
  useEffect(() => {
    loadDir(initialDrive, []);
    return () => {
      seqRef.current++;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [initialDrive, loadDir]);

  // Body scroll lock + Esc to close
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // ─── Navigation ────────────────────────────────────────────────────────────

  const navigate = (nextDrive, nextPath, { recordHistory = true } = {}) => {
    if (recordHistory) {
      setHistBack(prev => [...prev, { drive, path }]);
      setHistFwd([]);
    }
    setDrive(nextDrive);
    setPath(nextPath);
    loadDir(nextDrive, nextPath);
  };

  const goBack = () => {
    if (!histBack.length) return;
    const prev = histBack[histBack.length - 1];
    setHistBack(h => h.slice(0, -1));
    setHistFwd(h => [...h, { drive, path }]);
    setDrive(prev.drive);
    setPath(prev.path);
    loadDir(prev.drive, prev.path);
  };

  const goForward = () => {
    if (!histFwd.length) return;
    const next = histFwd[histFwd.length - 1];
    setHistFwd(h => h.slice(0, -1));
    setHistBack(h => [...h, { drive, path }]);
    setDrive(next.drive);
    setPath(next.path);
    loadDir(next.drive, next.path);
  };

  const openFolder = (name) => navigate(drive, [...path, name]);
  const goUp = () => { if (path.length) navigate(drive, path.slice(0, -1)); };

  const refresh = () => loadDir(drive, path, { force: true });

  const switchDrive = (d) => {
    if (d.name === drive.name && d.sourceMachine === drive.sourceMachine) return;
    navigate(d, []);
  };

  // ─── Sorting ───────────────────────────────────────────────────────────────

  const setSort = (key) => {
    if (sortKey === key) {
      setSortAsc(a => !a);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const entries = [...(listing?.entries || [])].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'name') cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    else if (sortKey === 'mtime') cmp = (a.mtime || 0) - (b.mtime || 0);
    else if (sortKey === 'size') cmp = (a.is_dir ? -1 : a.size || 0) - (b.is_dir ? -1 : b.size || 0);
    else if (sortKey === 'kind') cmp = kindOf(a).localeCompare(kindOf(b));
    if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return sortAsc ? cmp : -cmp;
  });

  // ─── Sidebar data: connected drives grouped by machine ────────────────────

  const machineGroups = {};
  for (const d of drives.filter(x => x.connected)) {
    const m = d.sourceMachine || 'Unknown';
    if (!machineGroups[m]) machineGroups[m] = [];
    machineGroups[m].push(d);
  }

  const machineOnline = onlineMachines?.has(drive.sourceMachine);
  const selectedEntry = entries.find(e => e.name === selected) || null;
  const folderName = path.length ? path[path.length - 1] : drive.name;

  const sortArrow = (key) => sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '';

  const modal = (
    <div className="finder-overlay" onClick={onClose}>
      <div className="finder-window" onClick={e => e.stopPropagation()}>

        {/* Title bar */}
        <div className="finder-titlebar">
          <div className="finder-lights">
            <button className="finder-light red" onClick={onClose} title="Close" aria-label="Close" />
            <span className="finder-light yellow" />
            <span className="finder-light green" />
          </div>
          <div className="finder-title">
            <FolderIcon size={15} />
            <span>{folderName}</span>
          </div>
          <div className="finder-titlebar-right" />
        </div>

        {/* Toolbar */}
        <div className="finder-toolbar">
          <div className="finder-nav-btns">
            <button className="finder-tbtn" onClick={goBack} disabled={!histBack.length} title="Back">‹</button>
            <button className="finder-tbtn" onClick={goForward} disabled={!histFwd.length} title="Forward">›</button>
            <button className="finder-tbtn" onClick={goUp} disabled={!path.length} title="Enclosing folder">↑</button>
          </div>
          <div className="finder-toolbar-label">
            {drive.sourceMachine}
            <LED state={machineOnline ? 'on' : 'off'} />
          </div>
          <div style={{ flex: 1 }} />
          <div className="finder-view-toggle">
            <button className={`finder-tbtn${view === 'icons' ? ' active' : ''}`} onClick={() => setView('icons')} title="Icon view">▦</button>
            <button className={`finder-tbtn${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')} title="List view">☰</button>
          </div>
          <button className="finder-tbtn" onClick={refresh} disabled={!!loading} title="Refresh (re-ask the scanner)">⟳</button>
        </div>

        {/* Body */}
        <div className="finder-body">
          {/* Sidebar */}
          <div className="finder-sidebar">
            <div className="finder-side-heading">Locations</div>
            {Object.entries(machineGroups).map(([machine, ds]) => (
              <div key={machine} className="finder-side-group">
                <div className="finder-side-machine">
                  <LED state={onlineMachines?.has(machine) ? 'on' : 'off'} />
                  <span>{machine}</span>
                </div>
                {ds.map(d => {
                  const isCurrent = d.name === drive.name && d.sourceMachine === drive.sourceMachine;
                  const browsable = onlineMachines?.has(machine);
                  return (
                    <button
                      key={d.id || d.name}
                      className={`finder-side-drive${isCurrent ? ' current' : ''}`}
                      onClick={() => browsable && switchDrive(d)}
                      disabled={!browsable}
                      title={browsable ? `Browse ${d.name}` : `${machine} is not live right now`}
                    >
                      <DriveGlyph />
                      <span className="nm">{d.name}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="finder-content">
            {loading ? (
              <div className="finder-state">
                <div className="finder-spinner" />
                <div className="finder-state-title">
                  {loading.stage === 'queued'
                    ? `Asking ${drive.sourceMachine} for this folder…`
                    : `${drive.sourceMachine} is reading the folder…`}
                </div>
                <div className="finder-state-sub">
                  Live listing from the scanner — the first visit to a folder can take ~10–15 seconds.
                </div>
              </div>
            ) : error ? (
              <div className="finder-state">
                <div className="finder-state-icon">⚠️</div>
                <div className="finder-state-title">Couldn&apos;t open this folder</div>
                <div className="finder-state-sub">{error}</div>
                <button className="btn ghost sm" onClick={refresh} style={{ marginTop: 12 }}>Try again</button>
              </div>
            ) : entries.length === 0 ? (
              <div className="finder-state">
                <FolderIcon size={40} />
                <div className="finder-state-title">Folder is empty</div>
              </div>
            ) : view === 'list' ? (
              <table className="finder-table">
                <thead>
                  <tr>
                    <th onClick={() => setSort('name')}>Name{sortArrow('name')}</th>
                    <th onClick={() => setSort('mtime')} className="w-date">Date Modified{sortArrow('mtime')}</th>
                    <th onClick={() => setSort('size')} className="w-size">Size{sortArrow('size')}</th>
                    <th onClick={() => setSort('kind')} className="w-kind">Kind{sortArrow('kind')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => (
                    <tr
                      key={e.name}
                      className={selected === e.name ? 'selected' : ''}
                      onClick={() => setSelected(e.name)}
                      onDoubleClick={() => e.is_dir && openFolder(e.name)}
                    >
                      <td>
                        <span className="finder-cell-name">
                          {e.is_dir ? <FolderIcon /> : <FileIcon entry={e} />}
                          <span className="nm">{e.name}</span>
                        </span>
                      </td>
                      <td className="w-date t-mono">{fmtDate(e.mtime)}</td>
                      <td className="w-size t-mono">{e.is_dir ? '—' : formatSize(e.size)}</td>
                      <td className="w-kind">{kindOf(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="finder-grid">
                {entries.map(e => (
                  <div
                    key={e.name}
                    className={`finder-grid-item${selected === e.name ? ' selected' : ''}`}
                    onClick={() => setSelected(e.name)}
                    onDoubleClick={() => e.is_dir && openFolder(e.name)}
                    title={e.name}
                  >
                    {e.is_dir ? <FolderIcon size={44} /> : <FileIcon entry={e} size={44} />}
                    <span className="nm">{e.name}</span>
                    {!e.is_dir && <span className="sz">{formatSize(e.size)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Path bar */}
        <div className="finder-pathbar">
          <button className="finder-crumb" onClick={() => path.length && navigate(drive, [])}>
            <DriveGlyph size={13} />
            <span>{drive.name}</span>
          </button>
          {path.map((seg, i) => (
            <span key={i} className="finder-crumb-wrap">
              <span className="finder-crumb-sep">›</span>
              <button
                className="finder-crumb"
                onClick={() => i < path.length - 1 && navigate(drive, path.slice(0, i + 1))}
              >
                <FolderIcon size={13} />
                <span>{seg}</span>
              </button>
            </span>
          ))}
        </div>

        {/* Status bar */}
        <div className="finder-statusbar">
          <span>
            {listing
              ? `${listing.total_items ?? entries.length} item${(listing.total_items ?? entries.length) === 1 ? '' : 's'}`
              : loading ? 'Loading…' : ''}
            {listing?.truncated ? ` (showing first ${entries.length})` : ''}
          </span>
          {selectedEntry && (
            <span className="finder-status-sel">
              {selectedEntry.name}{!selectedEntry.is_dir ? ` — ${formatSize(selectedEntry.size)}` : ''}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span>{formatSize(drive.free)} available</span>
        </div>
      </div>
    </div>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(modal, document.body);
}
