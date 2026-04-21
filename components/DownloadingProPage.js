import { useState, useEffect, useCallback } from 'react';
import { formatSize } from '../lib/format';

export default function DownloadingProPage({ drives }) {
  const [projects, setProjects] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [viewMode, setViewMode] = useState('list');

  const connectedDrives = drives.filter(d => d.connected);

  const fetchMachines = useCallback(async () => {
    try {
      const res = await fetch('/api/machines');
      if (res.ok) {
        const data = await res.json();
        setMachines(data || []);
      }
    } catch (err) { /* silent */ }
  }, []);

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

  // Auto-sync from Notion every 5 minutes
  const autoSync = useCallback(async () => {
    try {
      const res = await fetch('/api/notion-sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setLastSynced(new Date());
        if (data.errors?.length > 0) {
          setError(`Auto-sync: ${data.synced}/${data.total} with ${data.errors.length} errors`);
        }
      }
    } catch (err) { /* silent auto-sync failure */ }
    await fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchProjects();
    fetchMachines();
    // Sync from Notion on first load
    autoSync();
    // Refresh project list every 10s, sync from Notion every 5min, machines every 30s
    const refreshInterval = setInterval(fetchProjects, 10000);
    const syncInterval = setInterval(autoSync, 5 * 60 * 1000);
    const machineInterval = setInterval(fetchMachines, 30000);
    return () => { clearInterval(refreshInterval); clearInterval(syncInterval); clearInterval(machineInterval); };
  }, [fetchProjects, autoSync, fetchMachines]);

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
      const res = await fetch('/api/download-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action, ...extra }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `${action} failed (HTTP ${res.status})`);
        return;
      }
      setError(null);
      await fetchProjects();
    } catch (err) {
      setError(err.message);
    }
  };

  // Stats
  const totalCount = projects.length;
  const notDownloadedCount = projects.filter(p => (p.download_status || 'idle') === 'idle').length;
  const activeCount = projects.filter(p => ['downloading', 'copying', 'queued', 'paused'].includes(p.download_status)).length;
  const completedCount = projects.filter(p => p.download_status === 'completed').length;
  const failedCount = projects.filter(p => p.download_status === 'failed').length;

  // Filter and sort
  const statusFilter = (p) => {
    const s = p.download_status || 'idle';
    if (filter === 'all') return true;
    if (filter === 'idle') return s === 'idle';
    if (filter === 'active') return ['downloading', 'copying', 'queued', 'paused'].includes(s);
    if (filter === 'completed') return s === 'completed';
    if (filter === 'failed') return s === 'failed';
    return true;
  };

  const filtered = [...projects].filter(statusFilter).sort((a, b) => {
    const order = { downloading: 0, copying: 0, paused: 1, queued: 2, idle: 3, completed: 4, failed: 5 };
    const aOrder = order[a.download_status] ?? 6;
    const bOrder = order[b.download_status] ?? 6;
    if (aOrder !== bOrder) return aOrder - bOrder;
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
        <StatCard icon={'\u{1F4CB}'} iconBg="#f0fde0" label="Total" value={totalCount} sub="All projects" active={filter === 'all'} onClick={() => setFilter('all')} />
        <StatCard icon={'\u{1F4E5}'} iconBg="#fef3c7" label="Not Downloaded" value={notDownloadedCount} sub="Waiting" active={filter === 'idle'} onClick={() => setFilter('idle')} />
        <StatCard icon={'\u2B07'} iconBg="#dbeafe" label="Active" value={activeCount} sub="Downloading / Queued / Paused" active={filter === 'active'} onClick={() => setFilter('active')} />
        <StatCard icon={'\u2705'} iconBg="#d1fae5" label="Downloaded" value={completedCount} sub="Completed" active={filter === 'completed'} onClick={() => setFilter('completed')} />
        {failedCount > 0 && <StatCard icon={'\u274C'} iconBg="#fee2e2" label="Failed" value={failedCount} sub="Needs attention" active={filter === 'failed'} onClick={() => setFilter('failed')} />}
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
              <span className="dp-list-col dp-col-expand" />
              <span className="dp-list-col dp-col-name">Project</span>
              <span className="dp-list-col dp-col-client">Client</span>
              <span className="dp-list-col dp-col-date">Date</span>
              <span className="dp-list-col dp-col-status">Status</span>
              <span className="dp-list-col dp-col-queue">Queue</span>
              <span className="dp-list-col dp-col-actions">Actions</span>
            </div>
            {/* Table rows */}
            {filtered.map((project, i) => (
              <div key={project.id || i}>
                <ProjectRow
                  project={project}
                  connectedDrives={connectedDrives}
                  machines={machines}
                  onAction={handleAction}
                />
              </div>
            ))}
          </div>
        ) : (
          /* ===== GRID VIEW ===== */
          <div className="devices-grid">
            {filtered.map((project, i) => (
              <div key={project.id || i}>
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
function ProjectRow({ project, connectedDrives, machines, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const projectId = project.id;
  const downloadStatus = project.download_status || 'idle';
  const downloadLink = project.download_link || '';

  const statusConfig = {
    idle: { label: 'Not Downloaded', color: '#92400e', bg: '#fef3c7' },
    queued: { label: 'Queued', color: '#a16207', bg: '#fef9c3' },
    downloading: { label: 'Downloading', color: '#1d4ed8', bg: '#dbeafe' },
    paused: { label: 'Paused', color: '#6b7280', bg: '#f3f4f6' },
    copying: { label: 'Copying', color: '#4338ca', bg: '#e0e7ff' },
    completed: { label: 'Completed', color: '#15803d', bg: '#dcfce7' },
    failed: { label: 'Failed', color: '#dc2626', bg: '#fee2e2' },
  };

  const isDropbox = /dropbox/i.test(downloadLink);
  const isGDrive = /drive\.google|docs\.google/i.test(downloadLink);
  const isWeTransfer = /we\.tl|wetransfer/i.test(downloadLink);
  const sourceLabel = isDropbox ? 'Dropbox' : isGDrive ? 'Google Drive' : isWeTransfer ? 'WeTransfer' : downloadLink ? 'Link' : '—';
  const sourceColor = isDropbox ? '#1a56db' : isGDrive ? '#b45309' : isWeTransfer ? '#7c3aed' : '#8c8ca1';
  const sourceBg = isDropbox ? '#e8f0fe' : isGDrive ? '#fef3e2' : isWeTransfer ? '#f3e8ff' : '#f0f1f3';

  const sCfg = statusConfig[downloadStatus] || statusConfig.idle;

  const updateField = (field, value) => {
    onAction(projectId, 'update', { fields: { [field]: value } });
  };

  return (
    <div className={`dp-list-row-wrapper ${expanded ? 'expanded' : ''}`}>
      {/* Main row */}
      <div className="dp-list-row" onClick={() => setExpanded(!expanded)}>
        <span className="dp-list-col dp-col-expand">
          <span className={`dp-expand-arrow ${expanded ? 'open' : ''}`}>{'\u25B6'}</span>
        </span>
        <span className="dp-list-col dp-col-name">
          <EditableText
            value={project.couple_name || ''}
            placeholder="Project name"
            bold
            onSave={(val) => updateField('couple_name', val)}
          />
          {project.error_message && (
            <span className="dp-row-error" title={project.error_message}>
              {project.error_message}
            </span>
          )}
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
            onChange={(e) => { e.stopPropagation(); updateField('project_date', e.target.value); }}
            onClick={(e) => e.stopPropagation()}
          />
        </span>
        <span className="dp-list-col dp-col-status">
          <select
            className="dp-list-select-badge"
            value={downloadStatus}
            onChange={(e) => { e.stopPropagation(); updateField('download_status', e.target.value); }}
            onClick={(e) => e.stopPropagation()}
            style={{ background: sCfg.bg, color: sCfg.color }}
          >
            {Object.entries(statusConfig).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
        </span>
        <span className="dp-list-col dp-col-queue" onClick={(e) => e.stopPropagation()}>
          {downloadStatus === 'idle' || downloadStatus === 'queued' ? (
            <select
              className="dp-list-queue-select"
              value={project.queue_position || ''}
              onChange={(e) => {
                const pos = parseInt(e.target.value);
                if (pos) {
                  onAction(projectId, 'queue', { position: pos });
                } else {
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
        <span className="dp-list-col dp-col-actions" onClick={(e) => e.stopPropagation()}>
          {downloadStatus === 'idle' && (
            <button className="dp-list-action-btn primary" onClick={() => onAction(projectId, 'download_now')}>Download</button>
          )}
          {downloadStatus === 'downloading' && (
            <>
              <button className="dp-list-action-btn warn" onClick={() => onAction(projectId, 'pause')}>Pause</button>
              <button className="dp-list-action-btn danger" onClick={() => onAction(projectId, 'cancel')}>Cancel</button>
            </>
          )}
          {downloadStatus === 'paused' && (
            <>
              <button className="dp-list-action-btn primary" onClick={() => onAction(projectId, 'resume')}>Resume</button>
              <button className="dp-list-action-btn danger" onClick={() => onAction(projectId, 'cancel')}>Cancel</button>
            </>
          )}
          {downloadStatus === 'queued' && (
            <button className="dp-list-action-btn danger" onClick={() => onAction(projectId, 'cancel')}>Cancel</button>
          )}
          {downloadStatus === 'failed' && (
            <button className="dp-list-action-btn primary" onClick={() => onAction(projectId, 'download_now')}>Restart</button>
          )}
        </span>
      </div>

      {/* Expandable detail panel */}
      {expanded && (
        <div className="dp-list-detail">
          <div className="dp-detail-grid">
            <div className="dp-detail-field">
              <label className="dp-detail-label">Size</label>
              <EditableText
                value={project.size_gb || ''}
                placeholder="Enter size..."
                onSave={(val) => updateField('size_gb', val)}
              />
            </div>
            <div className="dp-detail-field">
              <label className="dp-detail-label">Target Drive</label>
              <select
                value={project.target_drive || ''}
                onChange={(e) => onAction(projectId, 'set-target', { targetDrive: e.target.value })}
                className="dp-list-select"
              >
                <option value="">Select drive...</option>
                {connectedDrives.map((d, i) => (
                  <option key={i} value={d.name}>{d.name} ({formatSize(d.free)} free)</option>
                ))}
              </select>
            </div>
            <div className="dp-detail-field">
              <label className="dp-detail-label">Source</label>
              <span className="dp-list-badge" style={{ background: sourceBg, color: sourceColor }}>{sourceLabel}</span>
            </div>
            <div className="dp-detail-field">
              <label className="dp-detail-label">Download Link</label>
              {downloadLink ? (
                <a href={downloadLink} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: '#3b82f6', textDecoration: 'none', wordBreak: 'break-all' }}>
                  {downloadLink.length > 70 ? downloadLink.substring(0, 70) + '...' : downloadLink}
                </a>
              ) : (
                <span style={{ fontSize: 12, color: '#b0b0c0' }}>No link</span>
              )}
            </div>
            <div className="dp-detail-field">
              <label className="dp-detail-label">Assigned Machine</label>
              <select
                value={project.assigned_machine || ''}
                onChange={(e) => onAction(projectId, 'assign_machine', { machine_name: e.target.value })}
                className="dp-list-select"
              >
                <option value="">Select machine...</option>
                {machines.map((m, i) => (
                  <option key={i} value={m.machine_name}>
                    {m.machine_name} {m.dropbox_path || m.gdrive_path ? '\u2601' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="dp-detail-field">
              <label className="dp-detail-label">Cloud Folder Path</label>
              <EditableText
                value={project.cloud_folder_path || ''}
                placeholder="Auto-detected or enter path..."
                onSave={(val) => updateField('cloud_folder_path', val)}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {downloadStatus === 'idle' && project.assigned_machine && (isDropbox || isGDrive) && (
              <button className="dp-list-action-btn cloud" onClick={() => onAction(projectId, 'start_cloud_download')}>
                {'\u2601'} Start Cloud Download
              </button>
            )}
            {downloadStatus === 'downloading' && project.assigned_machine && project.target_drive && (
              <button className="dp-list-action-btn primary" onClick={() => onAction(projectId, 'copy_to_drive')}>
                {'\u{1F4BE}'} Copy to Drive
              </button>
            )}
            <button className="dp-list-action-btn danger" onClick={() => onAction(projectId, 'remove')}>Remove Project</button>
          </div>
        </div>
      )}
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
    paused: { label: 'Paused', color: '#6b7280', bg: '#f3f4f6', dot: '#9ca3af' },
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
