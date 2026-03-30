import { useState, useEffect, useCallback } from 'react';
import { formatSize } from '../lib/format';

export default function DownloadingProPage({ drives }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

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

  // Filter
  const filtered = filter === 'all' ? projects
    : filter === 'idle' ? projects.filter(p => p.download_status === 'idle')
    : filter === 'downloading' ? projects.filter(p => p.download_status === 'downloading')
    : filter === 'queued' ? projects.filter(p => p.download_status === 'queued')
    : projects;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c8ca1' }}>
        <p style={{ fontSize: 18 }}>Loading projects...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Stat Cards — same pattern as dashboard */}
      <div className="stat-cards animate-in">
        <div className={`stat-card ${filter === 'all' ? 'accent' : ''}`} onClick={() => setFilter('all')} style={{ cursor: 'pointer' }}>
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: '#f0fde0' }}>{'\u{1F4CB}'}</div>
            <div className="stat-card-arrow">{'\u2197'}</div>
          </div>
          <div className="stat-card-label">Total Projects</div>
          <div className="stat-card-value">{totalCount}</div>
          <div className="stat-card-sub">From Notion sync</div>
        </div>

        <div className={`stat-card ${filter === 'idle' ? 'accent' : ''}`} onClick={() => setFilter('idle')} style={{ cursor: 'pointer' }}>
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: '#fef3c7' }}>{'\u{1F4E5}'}</div>
            <div className="stat-card-arrow">{'\u2197'}</div>
          </div>
          <div className="stat-card-label">Not Downloaded</div>
          <div className="stat-card-value">{notDownloadedCount}</div>
          <div className="stat-card-sub">Waiting to download</div>
        </div>

        <div className={`stat-card ${filter === 'downloading' ? 'accent' : ''}`} onClick={() => setFilter('downloading')} style={{ cursor: 'pointer' }}>
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: '#dbeafe' }}>{'\u2B07'}</div>
            <div className="stat-card-arrow">{'\u2197'}</div>
          </div>
          <div className="stat-card-label">Downloading</div>
          <div className="stat-card-value">{downloadingCount}</div>
          <div className="stat-card-sub">In progress now</div>
        </div>

        <div className={`stat-card ${filter === 'queued' ? 'accent' : ''}`} onClick={() => setFilter('queued')} style={{ cursor: 'pointer' }}>
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: '#fdf4ff' }}>{'\u{23F3}'}</div>
            <div className="stat-card-arrow">{'\u2197'}</div>
          </div>
          <div className="stat-card-label">Queued</div>
          <div className="stat-card-value">{queuedCount}</div>
          <div className="stat-card-sub">Up next</div>
        </div>
      </div>

      {/* Action bar — single line with sync + filter + timestamp */}
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
            Showing {filtered.length} of {totalCount} projects
          </span>
        </div>
      </div>

      {/* Projects Grid — same grid as devices */}
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
        ) : (
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

  // Source detection
  const isDropbox = /dropbox/i.test(downloadLink);
  const isGDrive = /drive\.google|docs\.google/i.test(downloadLink);
  const isWeTransfer = /we\.tl|wetransfer/i.test(downloadLink);

  // Status config
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
      {/* Top row: icon + name + status */}
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
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: sCfg.dot,
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: sCfg.color }}>{sCfg.label}</span>
        </div>
      </div>

      {/* Meta row */}
      <div className="device-meta" style={{ marginTop: 12 }}>
        {formattedDate && <span>{formattedDate}</span>}
        {sizeGb && <span>{sizeGb}{!sizeGb.toLowerCase().includes('gb') ? ' GB' : ''}</span>}
        {targetDrive && <span>{targetDrive}</span>}
        {!formattedDate && !sizeGb && !targetDrive && <span style={{ color: '#b0b0c0' }}>No details</span>}
      </div>

      {/* Download link */}
      {downloadLink && (
        <div style={{ marginTop: 8 }}>
          <a
            href={downloadLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 11, color: '#3b82f6', textDecoration: 'none', wordBreak: 'break-all' }}
          >
            {downloadLink.length > 55 ? downloadLink.substring(0, 55) + '...' : downloadLink}
          </a>
        </div>
      )}

      {/* Progress bar for downloading */}
      {(downloadStatus === 'downloading' || downloadStatus === 'copying') && (
        <div style={{ marginTop: 10 }}>
          <div className="drive-progress-bar">
            <div
              className="drive-progress-fill"
              style={{
                width: totalSize > 0 ? `${Math.min((progress / totalSize) * 100, 100)}%` : '0%',
                background: downloadStatus === 'copying'
                  ? 'linear-gradient(90deg, #8b5cf6, #a78bfa)'
                  : 'linear-gradient(90deg, #c8e600, #a3c400)',
              }}
            />
          </div>
          {totalSize > 0 && (
            <div style={{ fontSize: 11, color: '#8c8ca1', marginTop: 4 }}>
              {formatSize(progress)} / {formatSize(totalSize)}
            </div>
          )}
        </div>
      )}

      {/* Target drive selector */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#8c8ca1', fontWeight: 500 }}>Target:</span>
        <select
          value={targetDrive}
          onChange={(e) => onAction(projectId, 'set-target', { targetDrive: e.target.value })}
          style={{
            flex: 1, padding: '5px 8px', borderRadius: 8, border: '1px solid #e5e7eb',
            fontSize: 11, fontFamily: 'inherit', background: '#fff', color: '#4a4a6a',
            cursor: 'pointer',
          }}
        >
          <option value="">Select drive...</option>
          {connectedDrives.map((d, i) => (
            <option key={i} value={d.name}>{d.name} ({formatSize(d.free)} free)</option>
          ))}
        </select>
      </div>

      {/* Action buttons */}
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
  const bg = primary ? '#c8e600' : danger ? '#fff' : '#fff';
  const color = primary ? '#1a1a2e' : danger ? '#ef4444' : '#4a4a6a';
  const border = primary ? '#c8e600' : danger ? '#fecaca' : '#e5e7eb';

  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600,
        border: `1px solid ${border}`, background: bg, color,
        cursor: 'pointer', fontFamily: 'inherit',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => { e.target.style.transform = 'translateY(-1px)'; e.target.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; }}
      onMouseLeave={(e) => { e.target.style.transform = ''; e.target.style.boxShadow = ''; }}
    >
      {label}
    </button>
  );
}
