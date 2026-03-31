import { useState, useEffect, useCallback } from 'react';
import { formatSize } from '../lib/format';

export default function DownloadingProPage({ drives }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [viewMode, setViewMode] = useState('list');

  const connectedDrives = drives.filter(d => d.connected);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/download-projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      const data = await res.json();
      setProjects(data.projects || data || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 10000);
    return () => clearInterval(interval);
  }, [fetchProjects]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/notion-sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setLastSynced(new Date());
      if (data.errors?.length > 0) {
        setError(`Synced ${data.synced}/${data.total} with ${data.errors.length} errors`);
      }
      await fetchProjects();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleAction = async (projectId, action, extra = {}) => {
    try {
      await fetch('/api/download-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action, ...extra }),
      });
      await fetchProjects();
    } catch (err) {
      setError(err.message);
    }
  };

  // Stats
  const totalCount = projects.length;
  const notDownloadedCount = projects.filter(p => (p.download_status || 'idle') === 'idle').length;
  const downloadingCount = projects.filter(p => (p.download_status) === 'downloading').length;
  const queuedCount = projects.filter(p => (p.download_status) === 'queued').length;

  // Filter and sort (queued items sorted by position, downloading first)
  const baseFiltered = filter === 'all' ? projects
    : filter === 'idle' ? projects.filter(p => p.download_status === 'idle')
    : filter === 'downloading' ? projects.filter(p => p.download_status === 'downloading')
    : filter === 'queued' ? projects.filter(p => p.download_status === 'queued')
    : projects;

  const filtered = [...baseFiltered].sort((a, b) => {
    // Downloading first, then queued by position, then idle
    const order = { downloading: 0, copying: 0, queued: 1, idle: 2, completed: 3, failed: 4 };
    const aOrder = order[a.download_status] ?? 5;
    const bOrder = order[b.download_status] ?? 5;
    if (aOrder !== bOrder) return aOrder - bOrder;
    // Within queued, sort by position
    if (a.download_status === 'queued' && b.download_status === 'queued') {
      return (a.queue_position || 99) - (b.queue_position || 99);
    }
    return 0;
  });

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c8ca1' }}>
        <p style={{ fontSize: 18 }}>Loading projects...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Stat Cards */}
      <div className="stat-cards animate-in">
        <StatCard icon={'\u{1F4CB}'} iconBg="#f0fde0" label="Total Projects" value={totalCount} sub="From Notion sync" active={filter === 'all'} onClick={() => setFilter('all')} />
        <StatCard icon={'\u{1F4E5}'} iconBg="#fef3c7" label="Not Downloaded" value={notDownloadedCount} sub="Waiting to download" active={filter === 'idle'} onClick={() => setFilter('idle')} />
        <StatCard icon={'\u2B07'} iconBg="#dbeafe" label="Downloading" value={downloadingCount} sub="In progress now" active={filter === 'downloading'} onClick={() => setFilter('downloading')} />
        <StatCard icon={'\u{23F3}'} iconBg="#fdf4ff" label="Queued" value={queuedCount} sub="Up next" active={filter === 'queued'} onClick={() => setFilter('queued')} />
      </div>

      {/* Toolbar */}
      <div className="animate-in" style={{ animationDelay: '80ms' }}>
        <div className="dp-toolbar">
          <button
            className={`dp-toolbar-btn primary ${syncing ? 'syncing' : ''}`}
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? '\u{1F504} Syncing...' : '\u{1F504} Sync from Notion'}
          </button>

          {lastSynced && (
            <span className="dp-toolbar-meta">
              Last synced: {lastSynced.toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
              })}
            </span>
          )}

          {error && (
            <span className="dp-toolbar-error">
              {error}
              <button onClick={() => setError(null)} className="dp-toolbar-error-dismiss">{'\u2715'}</button>
            </span>
          )}

          <span className="dp-toolbar-spacer" />

          <span className="dp-toolbar-meta">
            {filtered.length} of {totalCount}
          </span>

          {/* View toggle */}
          <div className="dp-view-toggle">
            <button
              className={`dp-view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              {'\u2630'}
            </button>
            <button
              className={`dp-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              {'\u2587\u2587'}
            </button>
          </div>
        </div>
      </div>

      {/* Projects */}
      <div className="animate-in" style={{ animationDelay: '160ms' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c8ca1' }}>
            <p style={{ fontSize: 18 }}>
              {totalCount === 0 ? 'No projects yet' : 'No projects match this filter'}
            </p>
            <p style={{ fontSize: 14, marginTop: 8 }}>
              {totalCount === 0 ? 'Click "Sync from Notion" to pull in your download projects.' : 'Try selecting a different status above.'}
            </p>
          </div>
        ) : viewMode === 'list' ? (
          /* ===== LIST VIEW ===== */
          <div className="dp-list-container">
            {/* Table header */}
            <div className="dp-list-header">
              <span className="dp-list-col dp-col-name">Project</span>
              <span className="dp-list-col dp-col-client">Client</span>
              <span className="dp-list-col dp-col-date">Date</span>
              <span className="dp-list-col dp-col-size">Size</span>
              <span className="dp-list-col dp-col-drive">Drive</span>
              <span className="dp-list-col dp-col-source">Source</span>
              <span className="dp-list-col dp-col-status">Status</span>
              <span className="dp-list-col dp-col-queue">Queue</span>
              <span className="dp-list-col dp-col-actions">Actions</span>
            </div>
            {/* Table rows */}
            {filtered.map((project, i) => (
              <div key={project.id || i} className="scroll-reveal" style={{ transitionDelay: `${i * 40}ms` }}>
                <ProjectRow
                  project={project}
                  connectedDrives={connectedDrives}
                  onAction={handleAction}
                />
              </div>
            ))}
          </div>
        ) : (
          /* ===== GRID VIEW ===== */
          <div className="devices-grid">
            {filtered.map((project, i) => (
              <div key={project.id || i} className="scroll-reveal" style={{ transitionDelay: `${i * 60}ms` }}>
                <ProjectCard
                  project={project}
                  connectedDrives={connectedDrives}
                  onAction={handleAction}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, iconBg, label, value, sub, active, onClick }) {
  return (
    <div className={`stat-card ${active ? 'accent' : ''}`} onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="stat-card-top">
        <div className="stat-card-icon" style={{ background: iconBg }}>{icon}</div>
        <div className="stat-card-arrow">{'\u2197'}</div>
      </div>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-sub">{sub}</div>
    </div>
  );
}

/* ===== LIST VIEW ROW ===== */
function ProjectRow({ project, connectedDrives, onAction }) {
  const projectId = project.id;
  const downloadStatus = project.download_status || 'idle';
  const downloadLink = project.download_link || '';

  const statusConfig = {
    idle: { label: 'Not Downloaded', color: '#92400e', bg: '#fef3c7' },
    queued: { label: 'Queued', color: '#a16207', bg: '#fef9c3' },
    downloading: { label: 'Downloading', color: '#1d4ed8', bg: '#dbeafe' },
    copying: { label: 'Copying', color: '#4338ca', bg: '#e0e7ff' },
    completed: { label: 'Completed', color: '#15803d', bg: '#dcfce7' },
    failed: { label: 'Failed', color: '#dc2626', bg: '#fee2e2' },
  };

  const sourceOptions = [
    { value: '', label: '—', color: '#8c8ca1', bg: '#f0f1f3' },
    { value: 'dropbox', label: 'Dropbox', color: '#1a56db', bg: '#e8f0fe' },
    { value: 'google_drive', label: 'Google Drive', color: '#b45309', bg: '#fef3e2' },
    { value: 'wetransfer', label: 'WeTransfer', color: '#7c3aed', bg: '#f3e8ff' },
    { value: 'other', label: 'Other', color: '#8c8ca1', bg: '#f0f1f3' },
  ];

  // Detect current source
  const isDropbox = /dropbox/i.test(downloadLink);
  const isGDrive = /drive\.google|docs\.google/i.test(downloadLink);
  const isWeTransfer = /we\.tl|wetransfer/i.test(downloadLink);
  const currentSource = isDropbox ? 'dropbox' : isGDrive ? 'google_drive' : isWeTransfer ? 'wetransfer' : downloadLink ? 'other' : '';
  const srcOpt = sourceOptions.find(s => s.value === currentSource) || sourceOptions[0];

  const sCfg = statusConfig[downloadStatus] || statusConfig.idle;

  const updateField = (field, value) => {
    onAction(projectId, 'update', { fields: { [field]: value } });
  };

  return (
    <div className="dp-list-row">
      <span className="dp-list-col dp-col-name">
        <EditableText
          value={project.couple_name || ''}
          placeholder="Project name"
          bold
          onSave={(val) => updateField('couple_name', val)}
        />
      </span>
      <span className="dp-list-col dp-col-client">
        <EditableText
          value={project.client_name || ''}
          placeholder="Client name"
          onSave={(val) => updateField('client_name', val)}
        />
      </span>
      <span className="dp-list-col dp-col-date">
        <input
          type="date"
          className="dp-list-input dp-list-date-input"
          value={project.project_date || ''}
          onChange={(e) => updateField('project_date', e.target.value)}
        />
      </span>
      <span className="dp-list-col dp-col-size">
        <EditableText
          value={project.size_gb || ''}
          placeholder="—"
          onSave={(val) => updateField('size_gb', val)}
        />
      </span>
      <span className="dp-list-col dp-col-drive">
        <select
          value={project.target_drive || ''}
          onChange={(e) => onAction(projectId, 'set-target', { targetDrive: e.target.value })}
          className="dp-list-select"
        >
          <option value="">Select...</option>
          {connectedDrives.map((d, i) => (
            <option key={i} value={d.name}>{d.name}</option>
          ))}
        </select>
      </span>
      <span className="dp-list-col dp-col-source">
        <select
          className="dp-list-select-badge"
          value={currentSource}
          onChange={(e) => {
            // Source is auto-detected from link, so let user paste a link instead
          }}
          style={{ background: srcOpt.bg, color: srcOpt.color }}
          disabled
          title="Source is auto-detected from download link"
        >
          {sourceOptions.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </span>
      <span className="dp-list-col dp-col-status">
        <select
          className="dp-list-select-badge"
          value={downloadStatus}
          onChange={(e) => updateField('download_status', e.target.value)}
          style={{ background: sCfg.bg, color: sCfg.color }}
        >
          {Object.entries(statusConfig).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
      </span>
      <span className="dp-list-col dp-col-queue">
        {downloadStatus === 'idle' || downloadStatus === 'queued' ? (
          <select
            className="dp-list-queue-select"
            value={project.queue_position || ''}
            onChange={(e) => {
              const pos = parseInt(e.target.value);
              if (pos) {
                onAction(projectId, 'queue', { position: pos });
              } else {
                // Unqueue — set back to idle
                onAction(projectId, 'cancel');
              }
            }}
          >
            <option value="">—</option>
            <option value="1">Q1</option>
            <option value="2">Q2</option>
            <option value="3">Q3</option>
            <option value="4">Q4</option>
            <option value="5">Q5</option>
          </select>
        ) : (
          <span style={{ fontSize: 11, color: '#b0b0c0' }}>—</span>
        )}
      </span>
      <span className="dp-list-col dp-col-actions">
        {downloadStatus === 'idle' && (
          <button className="dp-list-action-btn primary" onClick={() => onAction(projectId, 'download_now')}>Download</button>
        )}
        {(downloadStatus === 'downloading' || downloadStatus === 'queued') && (
          <button className="dp-list-action-btn danger" onClick={() => onAction(projectId, 'cancel')}>Cancel</button>
        )}
      </span>
    </div>
  );
}

/* ===== INLINE EDITABLE TEXT ===== */
function EditableText({ value, placeholder, bold, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleBlur = () => {
    setEditing(false);
    if (draft !== value) {
      onSave(draft);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.target.blur(); }
    if (e.key === 'Escape') { setDraft(value); setEditing(false); }
  };

  if (editing) {
    return (
      <input
        className="dp-list-inline-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        autoFocus
        style={{ fontWeight: bold ? 700 : 400 }}
      />
    );
  }

  return (
    <span
      className={`dp-list-editable ${bold ? 'bold' : ''}`}
      onClick={() => { setDraft(value); setEditing(true); }}
      title="Click to edit"
    >
      {value || <span style={{ color: '#b0b0c0' }}>{placeholder}</span>}
    </span>
  );
}

/* ===== GRID VIEW CARD ===== */
function ProjectCard({ project, connectedDrives, onAction }) {
  const projectName = project.couple_name || 'Unknown Project';
  const clientName = project.client_name || 'Unknown Client';
  const downloadStatus = project.download_status || 'idle';
  const downloadLink = project.download_link || '';
  const targetDrive = project.target_drive || '';
  const sizeGb = project.size_gb || '';
  const projectDate = project.project_date || '';
  const progress = project.download_progress_bytes || 0;
  const totalSize = project.cloud_size_bytes || 0;
  const projectId = project.id;

  const isDropbox = /dropbox/i.test(downloadLink);
  const isGDrive = /drive\.google|docs\.google/i.test(downloadLink);
  const isWeTransfer = /we\.tl|wetransfer/i.test(downloadLink);

  const statusConfig = {
    idle: { label: 'Not Downloaded', color: '#92400e', bg: '#fef3c7', dot: '#f59e0b' },
    queued: { label: 'Queued', color: '#a16207', bg: '#fef9c3', dot: '#eab308' },
    downloading: { label: 'Downloading', color: '#1d4ed8', bg: '#dbeafe', dot: '#3b82f6' },
    copying: { label: 'Copying', color: '#4338ca', bg: '#e0e7ff', dot: '#6366f1' },
    completed: { label: 'Completed', color: '#15803d', bg: '#dcfce7', dot: '#22c55e' },
    failed: { label: 'Failed', color: '#dc2626', bg: '#fee2e2', dot: '#ef4444' },
  };
  const sCfg = statusConfig[downloadStatus] || statusConfig.idle;

  const formattedDate = projectDate ? new Date(projectDate + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) : '';

  return (
    <div className="device-card">
      <div className="device-card-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="device-icon" style={{ background: sCfg.bg }}>
            {isDropbox ? '\u{1F4E6}' : isGDrive ? '\u{1F4C1}' : isWeTransfer ? '\u{1F4E8}' : '\u{1F517}'}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>{projectName}</div>
            <div style={{ fontSize: 12, color: '#8c8ca1', marginTop: 2 }}>{clientName}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: sCfg.dot, display: 'inline-block' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: sCfg.color }}>{sCfg.label}</span>
        </div>
      </div>

      <div className="device-meta" style={{ marginTop: 12 }}>
        {formattedDate && <span>{formattedDate}</span>}
        {sizeGb && <span>{sizeGb}{!sizeGb.toLowerCase().includes('gb') ? ' GB' : ''}</span>}
        {targetDrive && <span>{targetDrive}</span>}
        {!formattedDate && !sizeGb && !targetDrive && <span style={{ color: '#b0b0c0' }}>No details</span>}
      </div>

      {downloadLink && (
        <div style={{ marginTop: 8 }}>
          <a href={downloadLink} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: '#3b82f6', textDecoration: 'none', wordBreak: 'break-all' }}>
            {downloadLink.length > 55 ? downloadLink.substring(0, 55) + '...' : downloadLink}
          </a>
        </div>
      )}

      {(downloadStatus === 'downloading' || downloadStatus === 'copying') && (
        <div style={{ marginTop: 10 }}>
          <div className="drive-progress-bar">
            <div className="drive-progress-fill" style={{
              width: totalSize > 0 ? `${Math.min((progress / totalSize) * 100, 100)}%` : '0%',
              background: downloadStatus === 'copying' ? 'linear-gradient(90deg, #8b5cf6, #a78bfa)' : 'linear-gradient(90deg, #c8e600, #a3c400)',
            }} />
          </div>
          {totalSize > 0 && (
            <div style={{ fontSize: 11, color: '#8c8ca1', marginTop: 4 }}>{formatSize(progress)} / {formatSize(totalSize)}</div>
          )}
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#8c8ca1', fontWeight: 500 }}>Target:</span>
        <select value={targetDrive} onChange={(e) => onAction(projectId, 'set-target', { targetDrive: e.target.value })}
          style={{ flex: 1, padding: '5px 8px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 11, fontFamily: 'inherit', background: '#fff', color: '#4a4a6a', cursor: 'pointer' }}>
          <option value="">Select drive...</option>
          {connectedDrives.map((d, i) => (
            <option key={i} value={d.name}>{d.name} ({formatSize(d.free)} free)</option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {downloadStatus === 'idle' && (
          <>
            <ActionBtn label="Download" primary onClick={() => onAction(projectId, 'download_now')} />
            <ActionBtn label="Queue" onClick={() => onAction(projectId, 'queue')} />
          </>
        )}
        {(downloadStatus === 'downloading' || downloadStatus === 'queued') && (
          <ActionBtn label="Cancel" danger onClick={() => onAction(projectId, 'cancel')} />
        )}
        <ActionBtn label="Remove" danger onClick={() => onAction(projectId, 'remove')} />
      </div>
    </div>
  );
}

function ActionBtn({ label, primary, danger, onClick }) {
  const bg = primary ? '#c8e600' : '#fff';
  const color = primary ? '#1a1a2e' : danger ? '#ef4444' : '#4a4a6a';
  const border = primary ? '#c8e600' : danger ? '#fecaca' : '#e5e7eb';
  return (
    <button onClick={onClick}
      style={{ padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: `1px solid ${border}`, background: bg, color, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s ease' }}
      onMouseEnter={(e) => { e.target.style.transform = 'translateY(-1px)'; e.target.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; }}
      onMouseLeave={(e) => { e.target.style.transform = ''; e.target.style.boxShadow = ''; }}>
      {label}
    </button>
  );
}
