import { useState, useEffect, useCallback } from 'react';
import { LED, Runway, Fuel, Src, Empty, fmtBytes, sourceFromLink } from './atoms';
import DownloadWizardModal from './DownloadWizardModal';
import DownloadMagicAnimation from './DownloadMagicAnimation';
import LiveDownloadProgress from './LiveDownloadProgress';

export default function DownloadingProPage({ drives, onProjectsChange }) {
  const [projects, setProjects] = useState([]);
  const [machines, setMachines] = useState([]);
  const [cloudAccounts, setCloudAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const [wizardProject, setWizardProject] = useState(null);
  const [magicProjectName, setMagicProjectName] = useState(null);

  const connectedDrives = (drives || []).filter(d => d.connected);

  const fetchMachines = useCallback(async () => {
    try {
      const res = await fetch('/api/machines');
      if (res.ok) setMachines((await res.json()) || []);
    } catch {}
  }, []);

  const fetchCloudAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/cloud-accounts');
      if (res.ok) {
        const data = await res.json();
        const rows = Array.isArray(data) ? data : data.accounts || [];
        setCloudAccounts(rows.filter(a => a.is_active !== false));
      }
    } catch {}
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/download-projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      const data = await res.json();
      const list = data.projects || data || [];
      setProjects(list);
      if (onProjectsChange) onProjectsChange(list);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onProjectsChange]);

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
    } catch {}
    await fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchProjects();
    fetchMachines();
    fetchCloudAccounts();
    autoSync();
    const refreshInterval = setInterval(fetchProjects, 10000);
    const syncInterval = setInterval(autoSync, 5 * 60 * 1000);
    const machineInterval = setInterval(fetchMachines, 30000);
    const cloudInterval = setInterval(fetchCloudAccounts, 60 * 1000);
    return () => {
      clearInterval(refreshInterval);
      clearInterval(syncInterval);
      clearInterval(machineInterval);
      clearInterval(cloudInterval);
    };
  }, [fetchProjects, autoSync, fetchMachines, fetchCloudAccounts]);

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
        if (data.error === 'MACHINE_REQUIRED') {
          const project = projects.find(p => p.id === projectId);
          if (project) { setWizardProject(project); setError(null); return; }
        }
        setError(data.error || `${action} failed (HTTP ${res.status})`);
        return;
      }
      setError(null);
      await fetchProjects();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDownloadClick = (project) => {
    if (!project.assigned_machine || !project.target_drive) {
      setWizardProject(project);
      return;
    }
    setMagicProjectName(project.couple_name || 'Project');
    handleAction(project.id, 'download_now');
  };

  const handleWizardSubmit = async ({ assigned_machine, target_drive, cloud_account_id }) => {
    if (!wizardProject) return;
    const pid = wizardProject.id;
    const name = wizardProject.couple_name || 'Project';
    setWizardProject(null);
    setMagicProjectName(name);
    const payload = { assigned_machine, target_drive };
    if (cloud_account_id) payload.cloud_account_id = cloud_account_id;
    await handleAction(pid, 'download_now', payload);
  };

  // Counts
  const counts = {
    all: projects.length,
    downloading: projects.filter(p => ['downloading', 'copying'].includes(p.download_status)).length,
    queued: projects.filter(p => p.download_status === 'queued').length,
    paused: projects.filter(p => p.download_status === 'paused').length,
    idle: projects.filter(p => (p.download_status || 'idle') === 'idle').length,
    completed: projects.filter(p => p.download_status === 'completed').length,
    failed: projects.filter(p => p.download_status === 'failed').length,
  };

  const filterFn = (p) => {
    const s = p.download_status || 'idle';
    if (filter === 'all') return true;
    if (filter === 'downloading') return ['downloading', 'copying'].includes(s);
    return s === filter;
  };

  const order = { downloading: 0, copying: 0, paused: 1, queued: 2, idle: 3, completed: 4, failed: 5 };
  const sorted = [...projects].filter(filterFn).sort((a, b) => {
    const oa = order[a.download_status] ?? 6;
    const ob = order[b.download_status] ?? 6;
    if (oa !== ob) return oa - ob;
    if (a.download_status === 'queued') return (a.queue_position || 99) - (b.queue_position || 99);
    return 0;
  });

  const CHIPS = [
    { k: 'all',         label: 'All',     count: counts.all },
    { k: 'downloading', label: 'Active',  count: counts.downloading },
    { k: 'queued',      label: 'Queued',  count: counts.queued },
    { k: 'paused',      label: 'Paused',  count: counts.paused },
    { k: 'idle',        label: 'Idle',    count: counts.idle },
    { k: 'completed',   label: 'Done',    count: counts.completed },
    { k: 'failed',      label: 'Failed',  count: counts.failed, alert: true },
  ];

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title"><h1>Transfers</h1></div>
        <div className="page-sub">
          Cloud → local → drive. Each row is one project; each step shows where in the pipeline it is.
        </div>
      </div>

      {/* Filter chips */}
      <div className="filter-strip">
        {CHIPS.map(chip => (
          <div
            key={chip.k}
            className={`filter-chip${filter === chip.k ? ' active' : ''}${chip.alert ? ' alert' : ''}`}
            onClick={() => setFilter(chip.k)}
          >
            <span className="l">{chip.label}</span>
            <span className="v">{chip.count}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="row between" style={{ marginBottom: 18 }}>
        <div className="row gap-12" style={{ alignItems: 'center' }}>
          <button
            className={`btn primary${syncing ? '' : ''}`}
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? '↻ Syncing…' : '↻ Sync from Notion'}
          </button>
          {lastSynced && (
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              Last synced · {lastSynced.toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
              })}
            </span>
          )}
          {error && (
            <span style={{ fontSize: 12, color: 'var(--alert-fg)', background: 'var(--alert-bg)', padding: '4px 10px', borderRadius: 'var(--r)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {error}
              <button className="btn ghost sm" onClick={() => setError(null)}>×</button>
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
          {sorted.length} of {projects.length} projects
        </span>
      </div>

      {/* Lanes */}
      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
          Loading projects…
        </div>
      ) : sorted.length === 0 ? (
        <Empty
          title="Nothing here"
          sub="Try a different filter above, or sync from Notion to pull in new projects."
        />
      ) : sorted.map(p => (
        <FullLane
          key={p.id}
          project={p}
          expanded={expanded === p.id}
          onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
          onAction={action => handleAction(p.id, action)}
          onDownloadClick={() => handleDownloadClick(p)}
          connectedDrives={connectedDrives}
          machines={machines}
          fetchProjects={fetchProjects}
        />
      ))}

      {wizardProject && (
        <DownloadWizardModal
          project={wizardProject}
          machines={machines}
          drives={drives}
          cloudAccounts={cloudAccounts}
          onClose={() => setWizardProject(null)}
          onSubmit={handleWizardSubmit}
        />
      )}

      {magicProjectName && (
        <DownloadMagicAnimation
          projectName={magicProjectName}
          onDone={() => setMagicProjectName(null)}
        />
      )}
    </div>
  );
}

// ── Full Transfer Lane ──────────────────────────────────────────────────────

function FullLane({ project: p, expanded, onToggle, onAction, onDownloadClick, connectedDrives, machines, fetchProjects }) {
  const status = p.download_status || 'idle';
  const phase = p.download_phase;
  const failed = status === 'failed';
  const active = ['downloading', 'copying'].includes(status);
  const pct = p.total_bytes_expected > 0
    ? Math.min(100, ((p.progress_bytes || 0) / p.total_bytes_expected) * 100)
    : 0;

  const STATUS_MAP = {
    downloading: { label: 'Staging',                             dot: 'on'    },
    copying:     { label: 'Copying',                             dot: 'mauve' },
    paused:      { label: 'Paused',                              dot: 'warn'  },
    queued:      { label: `Queued · #${p.queue_position || '?'}`, dot: 'warn' },
    completed:   { label: 'Complete',                            dot: 'on'    },
    failed:      { label: 'Failed',                              dot: 'alert' },
    idle:        { label: 'Idle',                                dot: 'off'   },
  };
  const s = STATUS_MAP[status] || STATUS_MAP.idle;

  const updateField = (field, value) => {
    onAction('update');
    fetch('/api/download-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: p.id, action: 'update', fields: { [field]: value } }),
    }).then(() => fetchProjects()).catch(() => {});
  };

  return (
    <div className={`lane${active ? ' active' : ''}`}>
      <div className="lane-top">
        <div className="lane-id">
          <div className="row gap-12" style={{ alignItems: 'baseline', flexWrap: 'nowrap', minWidth: 0 }}>
            <EditableText
              value={p.couple_name || ''}
              placeholder="Project name"
              bold
              onSave={val => updateField('couple_name', val)}
              className="nm"
            />
            <Src link={p.download_link} />
            <span style={{ fontSize: 12, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>
              <EditableText
                value={p.client_name || ''}
                placeholder="Client"
                onSave={val => updateField('client_name', val)}
              />
              {p.project_date && ` · ${p.project_date}`}
            </span>
          </div>
          <div className="meta">
            <strong>{p.assigned_machine || 'No machine'}</strong>
            <span style={{ margin: '0 6px', color: 'var(--ink-dim)' }}>→</span>
            <strong>{p.target_drive || 'No drive'}</strong>
            {p.size_gb && p.size_gb !== '—' && (
              <span style={{ color: 'var(--ink-dim)' }}> · {p.size_gb}</span>
            )}
          </div>
        </div>
        <div className="lane-right">
          <div className="row gap-8">
            <LED state={s.dot} />
            <span style={{
              fontSize: 12.5, fontWeight: 500,
              color: failed ? 'var(--alert-fg)' : active ? 'var(--accent-fg)' : 'var(--ink-2)',
            }}>
              {s.label}
            </span>
          </div>
          {(p.progress_bytes > 0 || p.total_bytes_expected > 0) && (
            <div className="bytes">
              {fmtBytes(p.progress_bytes || 0)}
              <span className="of"> / {fmtBytes(p.total_bytes_expected || 0)}</span>
            </div>
          )}
        </div>
      </div>

      <Runway status={status} phase={phase} failed={failed} />

      {(active || status === 'paused' || status === 'completed' || status === 'failed') && (
        <>
          <Fuel pct={pct} copying={status === 'copying'} failed={failed} />
          <div className="row between" style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 4 }}>
            <span className="t-mono">{pct.toFixed(1)}%</span>
          </div>
        </>
      )}

      {p.error_message && (
        <div style={{
          marginTop: 10, padding: '10px 14px',
          background: 'var(--alert-bg)', borderRadius: 'var(--r)',
          fontSize: 12.5, color: 'var(--alert-fg)',
        }}>
          {p.error_message}
        </div>
      )}

      {/* Actions */}
      <div className="lane-actions">
        {status === 'idle' && (
          <button className="btn primary" onClick={onDownloadClick}>Download</button>
        )}
        {status === 'downloading' && (
          <>
            <button className="btn" onClick={() => onAction('pause')}>Pause</button>
            <button className="btn danger" onClick={() => onAction('cancel')}>Cancel</button>
          </>
        )}
        {status === 'paused' && (
          <>
            <button className="btn primary" onClick={() => onAction('resume')} title="Resuming — already-synced files will skip.">Resume</button>
            <button className="btn danger" onClick={() => onAction('cancel')}>Cancel</button>
          </>
        )}
        {status === 'queued' && (
          <button className="btn danger" onClick={() => onAction('cancel')}>Cancel</button>
        )}
        {status === 'failed' && (
          <button className="btn primary" onClick={onDownloadClick}>Restart</button>
        )}
        {status === 'completed' && (
          <button
            className="btn"
            onClick={async () => {
              if (!confirm(
                'Re-download this project?\n\nThis clears the "completed" mark so you can pull a fresh copy.'
              )) return;
              await fetch('/api/download-projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: p.id, action: 'reset' }),
              });
              onDownloadClick();
            }}
          >
            Re-download
          </button>
        )}
        <button className="btn ghost" onClick={onToggle}>
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="lane-detail">
          <div className="f">
            <span className="l">Target drive</span>
            <span className="v">
              <select
                value={p.target_drive || ''}
                onChange={e => {
                  fetch('/api/download-projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: p.id, action: 'set-target', targetDrive: e.target.value }),
                  }).then(() => fetchProjects()).catch(() => {});
                }}
                style={{ background: 'transparent', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '4px 6px', fontSize: 12, color: 'var(--ink)', fontFamily: 'inherit' }}
              >
                <option value="">Select drive…</option>
                {connectedDrives.map(d => (
                  <option key={d.id || d.name} value={d.name}>{d.name} ({fmtBytes(d.free)} free)</option>
                ))}
              </select>
            </span>
          </div>
          <div className="f">
            <span className="l">Assigned machine</span>
            <span className="v">
              <select
                value={p.assigned_machine || ''}
                onChange={e => {
                  fetch('/api/download-projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: p.id, action: 'assign_machine', machine_name: e.target.value }),
                  }).then(() => fetchProjects()).catch(() => {});
                }}
                style={{ background: 'transparent', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '4px 6px', fontSize: 12, color: 'var(--ink)', fontFamily: 'inherit' }}
              >
                <option value="">Select machine…</option>
                {machines.map(m => (
                  <option key={m.machine_name} value={m.machine_name}>{m.machine_name}</option>
                ))}
              </select>
            </span>
          </div>
          <div className="f">
            <span className="l">Project date</span>
            <span className="v">
              <input
                type="date"
                value={p.project_date || ''}
                onChange={e => updateField('project_date', e.target.value)}
                style={{ background: 'transparent', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '4px 6px', fontSize: 12, color: 'var(--ink)', fontFamily: 'inherit' }}
              />
            </span>
          </div>
          <div className="f">
            <span className="l">Size</span>
            <span className="v">
              <EditableText
                value={p.size_gb || ''}
                placeholder="Enter size…"
                onSave={val => updateField('size_gb', val)}
              />
            </span>
          </div>
          <div className="f">
            <span className="l">Cloud folder path</span>
            <span className="v dim" style={{ wordBreak: 'break-all' }}>
              <EditableText
                value={p.cloud_folder_path || ''}
                placeholder="Auto-detected or enter path…"
                onSave={val => updateField('cloud_folder_path', val)}
              />
            </span>
          </div>
          <div className="f">
            <span className="l">Phase</span>
            <span className="v">{p.download_phase || '—'}</span>
          </div>
          <div className="f">
            <span className="l">Download link</span>
            <span className="v dim" style={{ wordBreak: 'break-all' }}>
              {p.download_link
                ? (p.download_link.length > 56 ? p.download_link.slice(0, 56) + '…' : p.download_link)
                : '—'}
            </span>
          </div>

          {/* Live progress */}
          {status === 'downloading' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <LiveDownloadProgress projectId={p.id} status={status} />
            </div>
          )}

          {/* Cloud-only download + copy-to-drive actions */}
          {status === 'idle' && p.assigned_machine && (() => {
            const src = sourceFromLink(p.download_link);
            return (src === 'dropbox' || src === 'gdrive') ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <button className="btn" onClick={() => onAction('start_cloud_download')}>
                  ↓ Start cloud download
                </button>
              </div>
            ) : null;
          })()}
          {status === 'downloading' && p.assigned_machine && p.target_drive && (
            <div style={{ gridColumn: '1 / -1' }}>
              <button className="btn" onClick={() => onAction('copy_to_drive')}>
                Copy to drive
              </button>
            </div>
          )}

          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, paddingTop: 6 }}>
            <button className="btn danger" onClick={() => onAction('remove')}>Remove from board</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inline editable text ──────────────────────────────────────────────────

function EditableText({ value, placeholder, bold, onSave, className }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleBlur = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') e.target.blur();
    if (e.key === 'Escape') { setDraft(value); setEditing(false); }
  };

  if (editing) {
    return (
      <input
        style={{
          border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)',
          padding: '2px 6px', fontSize: 'inherit', fontFamily: 'inherit',
          fontWeight: bold ? 700 : 400, color: 'var(--ink)', background: 'var(--panel)', outline: 0,
        }}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        autoFocus
      />
    );
  }

  return (
    <span
      className={className}
      onClick={() => { setDraft(value); setEditing(true); }}
      style={{ cursor: 'text', fontWeight: bold ? 700 : undefined }}
      title="Click to edit"
    >
      {value || <span style={{ color: 'var(--ink-dim)' }}>{placeholder}</span>}
    </span>
  );
}
