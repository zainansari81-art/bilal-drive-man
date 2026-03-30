import { useState, useEffect, useCallback } from 'react';
import { formatSize } from '../lib/format';

export default function DownloadingProPage({ drives }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [autoSync, setAutoSync] = useState(true);
  const [error, setError] = useState(null);
  const [cloudAccounts, setCloudAccounts] = useState([]);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ account_name: '', account_type: 'dropbox', email: '', local_sync_path: '' });

  const connectedDrives = drives.filter(d => d.connected);

  const fetchCloudAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/cloud-accounts');
      if (res.ok) {
        const data = await res.json();
        setCloudAccounts(data || []);
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

  useEffect(() => {
    fetchProjects();
    fetchCloudAccounts();
    const interval = setInterval(fetchProjects, 10000);
    return () => clearInterval(interval);
  }, [fetchProjects, fetchCloudAccounts]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/notion-sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setLastSynced(new Date());
      if (data.errors?.length > 0) {
        setError(`Synced ${data.synced}/${data.total} — ${data.errors.length} errors`);
      }
      await fetchProjects();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleCloudAction = async (projectId, action, accountId) => {
    try {
      await fetch('/api/download-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action, accountId }),
      });
      await fetchProjects();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDownloadNow = async (projectId) => {
    try {
      await fetch('/api/download-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, command: 'download' }),
      });
      await fetchProjects();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddToQueue = async (projectId) => {
    try {
      await fetch('/api/download-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, command: 'queue' }),
      });
      await fetchProjects();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCancel = async (projectId) => {
    try {
      await fetch('/api/download-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, command: 'cancel' }),
      });
      await fetchProjects();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemove = async (projectId) => {
    try {
      await fetch('/api/download-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action: 'remove' }),
      });
      await fetchProjects();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTargetDriveChange = async (projectId, driveName) => {
    try {
      await fetch('/api/download-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action: 'set-target', targetDrive: driveName }),
      });
      await fetchProjects();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddAccount = async () => {
    if (!newAccount.account_name || !newAccount.account_type) return;
    try {
      await fetch('/api/cloud-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', ...newAccount }),
      });
      setNewAccount({ account_name: '', account_type: 'dropbox', email: '', local_sync_path: '' });
      setShowAddAccount(false);
      await fetchCloudAccounts();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteAccount = async (id) => {
    try {
      await fetch('/api/cloud-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      await fetchCloudAccounts();
    } catch (err) {
      setError(err.message);
    }
  };

  const dropboxAccounts = cloudAccounts.filter(a => a.account_type === 'dropbox' && a.is_active);
  const gdriveAccounts = cloudAccounts.filter(a => a.account_type === 'google_drive' && a.is_active);

  // Compute stats
  const totalCount = projects.length;
  const notDownloadedCount = projects.filter(p => (p.download_status || p.downloadStatus) === 'idle').length;
  const downloadingCount = projects.filter(p => (p.download_status || p.downloadStatus) === 'downloading').length;
  const queuedCount = projects.filter(p => (p.download_status || p.downloadStatus) === 'queued').length;
  const queuedProjects = projects.filter(p => (p.download_status || p.downloadStatus) === 'queued').sort((a, b) => (a.queue_position || 0) - (b.queue_position || 0));

  // Machines from projects
  const machineMap = {};
  for (const p of projects) {
    const machine = p.assigned_machine || p.assignedMachine;
    if (machine) {
      if (!machineMap[machine]) {
        machineMap[machine] = { name: machine, downloadCount: 0, online: false };
      }
      if (p.download_status === 'downloading') {
        machineMap[machine].downloadCount++;
        machineMap[machine].online = true;
      }
    }
  }
  // Also mark machines as online if they appear in connected drives
  for (const d of connectedDrives) {
    const machine = d.sourceMachine;
    if (machine) {
      if (!machineMap[machine]) {
        machineMap[machine] = { name: machine, downloadCount: 0, online: true };
      } else {
        machineMap[machine].online = true;
      }
    }
  }
  const machines = Object.values(machineMap);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c8ca1' }}>
        <p style={{ fontSize: 18 }}>Loading projects...</p>
      </div>
    );
  }

  return (
    <div className="dp-container">
      {/* Stats Bar */}
      <div className="dp-stats-bar">
        <StatCard label="Total Projects" value={totalCount} />
        <StatCard label="Not Downloaded" value={notDownloadedCount} accent />
        <StatCard label="Downloading" value={downloadingCount} />
        <StatCard label="Queued" value={queuedCount} />
      </div>

      {/* Sync Bar */}
      <div className="dp-sync-bar">
        <div className="dp-sync-left">
          <button
            className={`dp-sync-btn ${syncing ? 'syncing' : ''}`}
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? 'Syncing...' : 'Sync from Notion'}
          </button>
          {lastSynced && (
            <span className="dp-sync-timestamp">
              Last synced: {lastSynced.toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
              })}
            </span>
          )}
        </div>
        <div className="dp-sync-right">
          <span className={`dp-auto-sync-indicator ${autoSync ? 'active' : ''}`}>
            {autoSync ? '\u25CF' : '\u25CB'} Auto-sync {autoSync ? 'ON' : 'OFF'}
          </span>
          <button
            className="dp-auto-sync-toggle"
            onClick={() => setAutoSync(!autoSync)}
          >
            {autoSync ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      {/* Cloud Accounts */}
      <div className="dp-accounts-section">
        <div className="dp-section-header">
          <span>Cloud Accounts</span>
          <span className="dp-section-count">{cloudAccounts.length}</span>
          <button className="dp-action-btn primary" style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 11 }} onClick={() => setShowAddAccount(!showAddAccount)}>
            {showAddAccount ? 'Cancel' : '+ Add Account'}
          </button>
        </div>

        {showAddAccount && (
          <div className="dp-add-account-form">
            <select
              className="dp-target-select"
              value={newAccount.account_type}
              onChange={e => setNewAccount({ ...newAccount, account_type: e.target.value })}
            >
              <option value="dropbox">Dropbox</option>
              <option value="google_drive">Google Drive</option>
            </select>
            <input
              className="dp-input"
              placeholder="Account name (e.g. Main Dropbox)"
              value={newAccount.account_name}
              onChange={e => setNewAccount({ ...newAccount, account_name: e.target.value })}
            />
            <input
              className="dp-input"
              placeholder="Email (optional)"
              value={newAccount.email}
              onChange={e => setNewAccount({ ...newAccount, email: e.target.value })}
            />
            <input
              className="dp-input"
              placeholder="Local sync folder path (e.g. /Users/bilal/Dropbox)"
              value={newAccount.local_sync_path}
              onChange={e => setNewAccount({ ...newAccount, local_sync_path: e.target.value })}
            />
            <button className="dp-action-btn primary" onClick={handleAddAccount}>Save Account</button>
          </div>
        )}

        {cloudAccounts.length > 0 && (
          <div className="dp-accounts-grid">
            {cloudAccounts.map(account => (
              <div key={account.id} className="dp-account-card">
                <div className="dp-account-icon">
                  {account.account_type === 'dropbox' ? '\uD83D\uDCE6' : '\uD83D\uDCC1'}
                </div>
                <div className="dp-account-info">
                  <div className="dp-account-name">{account.account_name}</div>
                  <div className="dp-account-detail">
                    {account.account_type === 'dropbox' ? 'Dropbox' : 'Google Drive'}
                    {account.email ? ` \u2022 ${account.email}` : ''}
                  </div>
                  {account.local_sync_path && (
                    <div className="dp-account-path">{account.local_sync_path}</div>
                  )}
                </div>
                <button
                  className="dp-action-btn danger"
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  onClick={() => handleDeleteAccount(account.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {cloudAccounts.length === 0 && !showAddAccount && (
          <div style={{ textAlign: 'center', padding: '16px', color: '#8c8ca1', fontSize: 13 }}>
            No cloud accounts added yet. Add your Dropbox and Google Drive accounts to get started.
          </div>
        )}
      </div>

      {error && (
        <div className="dp-error-banner">
          {error}
          <button onClick={() => setError(null)} className="dp-error-dismiss">{'\u2715'}</button>
        </div>
      )}

      {/* Projects List */}
      <div className="dp-projects-list">
        {projects.length === 0 ? (
          <div className="dp-empty-state">
            <p className="dp-empty-title">No projects yet</p>
            <p className="dp-empty-subtitle">Sync from Notion to pull in your download projects.</p>
          </div>
        ) : (
          projects.map((project, i) => (
            <div key={project.id || i} className="dp-project-card scroll-reveal" style={{ transitionDelay: `${i * 40}ms` }}>
              <ProjectCard
                project={project}
                connectedDrives={connectedDrives}
                cloudAccounts={cloudAccounts}
                onCloudAction={handleCloudAction}
                onDownloadNow={handleDownloadNow}
                onAddToQueue={handleAddToQueue}
                onCancel={handleCancel}
                onRemove={handleRemove}
                onTargetDriveChange={handleTargetDriveChange}
              />
            </div>
          ))
        )}
      </div>

      {/* Queue Section */}
      {queuedProjects.length > 0 && (
        <div className="dp-queue-section">
          <h3 className="dp-section-title">Download Queue</h3>
          {queuedProjects.map((project, i) => (
            <div key={project.id || i} className="dp-queue-item">
              <span className="dp-queue-position">#{i + 1}</span>
              <span className="dp-queue-name">
                {project.couple_name || project.coupleName} — {project.client_name || project.clientName}
              </span>
              <span className="dp-queue-target">
                {project.target_drive || project.targetDrive || 'No drive'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Download Machines Panel */}
      {machines.length > 0 && (
        <div className="dp-machines-panel">
          <h3 className="dp-section-title">Download Machines</h3>
          <div className="dp-machines-grid">
            {machines.map((machine) => (
              <div key={machine.name} className="dp-machine-card">
                <div className="dp-machine-header">
                  <span className="dp-machine-icon">{'\uD83D\uDCBB'}</span>
                  <span className="dp-machine-name">{machine.name}</span>
                  <span className={`dp-machine-status ${machine.online ? 'online' : 'offline'}`}>
                    {machine.online ? 'Online' : 'Offline'}
                  </span>
                </div>
                <div className="dp-machine-downloads">
                  {machine.downloadCount > 0
                    ? `${machine.downloadCount} active download${machine.downloadCount !== 1 ? 's' : ''}`
                    : 'Idle'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className={`dp-stat-card ${accent ? 'accent' : ''}`}>
      <div className="dp-stat-value">{value}</div>
      <div className="dp-stat-label">{label}</div>
    </div>
  );
}

function ProjectCard({
  project,
  connectedDrives,
  cloudAccounts = [],
  onCloudAction,
  onDownloadNow,
  onAddToQueue,
  onCancel,
  onRemove,
  onTargetDriveChange,
}) {
  const projectName = project.couple_name || project.coupleName || 'Unknown Project';
  const clientName = project.client_name || project.clientName || 'Unknown Client';
  const downloadStatus = project.download_status || project.downloadStatus || 'idle';
  const downloadLink = project.download_link || project.downloadLink || '';
  const targetDrive = project.target_drive || project.targetDrive || '';
  const assignedMachine = project.assigned_machine || project.assignedMachine || '';
  const sizeGb = project.size_gb || project.sizeGb || '';
  const projectDate = project.project_date || project.projectDate || '';
  const progress = project.progress || 0;
  const queuePosition = project.queue_position || project.queuePosition;
  const totalSize = project.total_size || project.totalSize || 0;
  const downloadedSize = project.downloaded_size || project.downloadedSize || 0;
  const projectId = project.id;

  // Detect source type from link
  const isDropbox = /dropbox/i.test(downloadLink);
  const isGDrive = /drive\.google|docs\.google/i.test(downloadLink);
  const isWeTransfer = /we\.tl|wetransfer/i.test(downloadLink);
  const sourceType = isDropbox ? 'dropbox' : isGDrive ? 'gdrive' : isWeTransfer ? 'wetransfer' : downloadLink ? 'link' : 'none';
  const sourceIcon = isDropbox ? '📦' : isGDrive ? '📁' : isWeTransfer ? '📨' : '🔗';
  const sourceLabel = isDropbox ? 'Dropbox' : isGDrive ? 'Google Drive' : isWeTransfer ? 'WeTransfer' : downloadLink ? 'Link' : 'No Link';

  // Format date nicely
  const formattedDate = projectDate ? new Date(projectDate + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) : '';

  return (
    <div className="dp-project-inner">
      <div className="dp-project-header">
        <div className="dp-project-info">
          <span className="dp-project-name">{projectName}</span>
          <span className="dp-project-client">{clientName}</span>
        </div>
        <div className="dp-project-badges">
          <span className={`dp-project-source ${sourceType}`}>
            {sourceIcon} {sourceLabel}
          </span>
          <StatusBadge status={downloadStatus} />
        </div>
      </div>

      {/* Project details row */}
      <div className="dp-project-details">
        {formattedDate && (
          <span className="dp-detail-item">
            📅 {formattedDate}
          </span>
        )}
        {sizeGb && (
          <span className="dp-detail-item">
            💾 {sizeGb} {!sizeGb.toLowerCase().includes('gb') ? 'GB' : ''}
          </span>
        )}
        {targetDrive && (
          <span className="dp-detail-item">
            💿 {targetDrive}
          </span>
        )}
        {assignedMachine && (
          <span className="dp-detail-item">
            🖥️ {assignedMachine}
          </span>
        )}
      </div>

      <div className="dp-project-body">
        {(downloadStatus === 'downloading' || downloadStatus === 'copying') && (
          <DownloadStatusDisplay
            status={downloadStatus}
            progress={progress}
            queuePosition={queuePosition}
            totalSize={totalSize}
            downloadedSize={downloadedSize}
          />
        )}

        {downloadLink && (
          <div className="dp-link-row">
            <a href={downloadLink} target="_blank" rel="noopener noreferrer" className="dp-link-url">
              {downloadLink.length > 60 ? downloadLink.substring(0, 60) + '...' : downloadLink}
            </a>
          </div>
        )}

        <div className="dp-project-meta">
          <div className="dp-target-row">
            <label className="dp-target-label">Target Drive:</label>
            <select
              className="dp-target-select"
              value={targetDrive}
              onChange={(e) => onTargetDriveChange(projectId, e.target.value)}
            >
              <option value="">Select drive...</option>
              {connectedDrives.map((d, i) => (
                <option key={i} value={d.name}>{d.name} ({formatSize(d.free)} free)</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="dp-actions">
        {downloadStatus === 'idle' && (
          <>
            <button
              className="dp-action-btn primary"
              onClick={() => onDownloadNow(projectId)}
            >
              Download Now
            </button>
            <button
              className="dp-action-btn queue"
              onClick={() => onAddToQueue(projectId)}
            >
              Add to Queue
            </button>
          </>
        )}
        {downloadStatus === 'queued' && (
          <button
            className="dp-action-btn danger"
            onClick={() => onCancel(projectId)}
          >
            Cancel
          </button>
        )}
        {downloadStatus === 'downloading' && (
          <button
            className="dp-action-btn danger"
            onClick={() => onCancel(projectId)}
          >
            Cancel Download
          </button>
        )}
        <button
          className="dp-action-btn danger"
          onClick={() => onRemove(projectId)}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const config = {
    idle: { label: 'Not Downloaded', className: 'idle' },
    queued: { label: 'Queued', className: 'queued' },
    downloading: { label: 'Downloading', className: 'downloading' },
    copying: { label: 'Copying', className: 'copying' },
    completed: { label: 'Completed', className: 'completed' },
    failed: { label: 'Failed', className: 'failed' },
  };
  const c = config[status] || config.idle;
  return (
    <span className={`dp-status-badge ${c.className}`}>
      {c.label}
    </span>
  );
}

function DownloadStatusDisplay({ status, progress, queuePosition, totalSize, downloadedSize }) {
  const statusConfig = {
    idle: { label: 'Idle', className: 'idle', icon: '\u23F8' },
    queued: { label: `Queued #${queuePosition || '?'}`, className: 'queued', icon: '\u23F3' },
    downloading: { label: 'Downloading', className: 'downloading', icon: '\u2B07' },
    copying: { label: 'Copying to drive', className: 'copying', icon: '\uD83D\uDCBE' },
    completed: { label: 'Completed \u2705', className: 'completed', icon: '' },
    failed: { label: 'Failed \u274C', className: 'failed', icon: '' },
  };

  const cfg = statusConfig[status] || statusConfig.idle;

  return (
    <div className={`dp-download-status ${cfg.className}`}>
      <div className="dp-status-label">
        {cfg.icon && <span className="dp-status-icon">{cfg.icon}</span>}
        {cfg.label}
        {status === 'downloading' && totalSize > 0 && (
          <span className="dp-status-size">
            {' '}{formatSize(downloadedSize)} / {formatSize(totalSize)}
          </span>
        )}
      </div>
      {(status === 'downloading' || status === 'copying') && (
        <div className="dp-progress-bar">
          <div
            className="dp-progress-fill"
            style={{ width: `${Math.min(progress, 100)}%` }}
          ></div>
          <span className="dp-progress-text">{Math.round(progress)}%</span>
        </div>
      )}
    </div>
  );
}
