import { useState, useEffect } from 'react';
import { formatSize } from '../lib/format';

/**
 * Two-step wizard shown when a user clicks Download on a project that is
 * missing either an assigned machine or a target drive.
 *
 * Step 1: Machine (required).
 * Step 2: Target drive (optional — Skip = sync to the PC's cloud folder only,
 *         user can copy to a drive later).
 */
export default function DownloadWizardModal({
  project,
  machines,
  drives,
  cloudAccounts,
  onClose,
  onSubmit,
}) {
  const [step, setStep] = useState(1);
  const [machine, setMachine] = useState(project?.assigned_machine || '');
  const [drive, setDrive] = useState(project?.target_drive || '');
  // Gap 1 — optional cloud account selection. null = "use PC's default cloud
  // path" (today's behavior). A UUID = route to a specific cloud_accounts row.
  // Starts from whatever the project already had so re-opening the wizard for
  // a project with a prior pick doesn't silently drop it.
  const [cloudAccountId, setCloudAccountId] = useState(
    project?.cloud_account_id || null
  );
  const [submitting, setSubmitting] = useState(false);

  const connectedDrives = (drives || []).filter((d) => d.connected);

  // Only show cloud accounts matching this project's link_type — routing a
  // dropbox project to a Google Drive account is nonsensical.
  const relevantCloudAccounts = (cloudAccounts || []).filter((a) => {
    if (!a || a.is_active === false) return false;
    if (!project?.link_type) return false;
    return a.account_type === project.link_type;
  });
  const showCloudPicker = relevantCloudAccounts.length > 0;

  // Parse the "Size in Gbs" Notion string into bytes for disk-space checks.
  // Accepts "50", "50 GB", "50GB", "500 MB", "1.2 TB". Returns null on junk.
  const projectSizeBytes = (() => {
    const raw = (project?.size_gb || '').toString().trim();
    if (!raw) return null;
    const match = raw.match(/([\d.]+)\s*(tb|gb|mb|kb|b)?/i);
    if (!match) return null;
    const n = parseFloat(match[1]);
    if (isNaN(n)) return null;
    const unit = (match[2] || 'gb').toLowerCase();
    const mult = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 }[unit] || 1e9;
    return n * mult;
  })();

  // Headroom rule: require 10% buffer on top of the estimated size.
  const selectedDrive = connectedDrives.find((d) => d.name === drive);
  let spaceWarning = null;
  if (selectedDrive && projectSizeBytes != null) {
    const needed = projectSizeBytes * 1.1;
    if (selectedDrive.free != null && selectedDrive.free < projectSizeBytes) {
      spaceWarning = {
        level: 'error',
        text: `Not enough space: ${formatSize(selectedDrive.free)} free, project is ~${formatSize(projectSizeBytes)}.`,
      };
    } else if (selectedDrive.free != null && selectedDrive.free < needed) {
      spaceWarning = {
        level: 'warn',
        text: `Tight fit: ${formatSize(selectedDrive.free)} free vs ~${formatSize(projectSizeBytes)} needed. Consider a bigger drive.`,
      };
    }
  }

  // Jump straight to the step the user actually needs. If machine is already
  // set but drive isn't, skip step 1.
  useEffect(() => {
    if (project?.assigned_machine && !project?.target_drive) {
      setStep(2);
    }
  }, [project]);

  if (!project) return null;

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
  };

  const canAdvanceStep1 = !!machine;

  const handleNext = () => {
    if (step === 1 && canAdvanceStep1) {
      setStep(2);
    }
  };

  const handleSubmit = async (skipDrive = false) => {
    if (!machine) return;
    setSubmitting(true);
    try {
      await onSubmit({
        assigned_machine: machine,
        target_drive: skipDrive ? '' : drive,
        cloud_account_id: cloudAccountId,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="delete-modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        className="delete-modal"
        style={{ maxWidth: 460, textAlign: 'left' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="delete-modal-icon" style={{ fontSize: 28 }}>
              {step === 1 ? '\u{1F5A5}' : '\u{1F4BE}'}
            </span>
            <h3 style={{ margin: 0, fontSize: 17 }}>
              {step === 1 ? 'Pick a PC' : 'Pick a drive'}
            </h3>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8c8ca1' }}>Step {step} of 2</span>
        </div>

        {/* Project summary */}
        <div className="delete-modal-detail" style={{ marginTop: 16 }}>
          <div className="delete-modal-detail-row">
            <span>Project</span>
            <span>{project.couple_name || 'Unknown'}</span>
          </div>
          <div className="delete-modal-detail-row">
            <span>Client</span>
            <span>{project.client_name || 'Unknown'}</span>
          </div>
          {project.size_gb && (
            <div className="delete-modal-detail-row">
              <span>Size</span>
              <span>{project.size_gb}</span>
            </div>
          )}
        </div>

        {/* Step 1: machine */}
        {step === 1 && (
          <>
            <p className="delete-modal-desc" style={{ textAlign: 'left', marginBottom: 10 }}>
              Which PC should handle this download?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {machines && machines.length > 0 ? (
                machines.map((m) => {
                  const hasCloud = !!(m.dropbox_path || m.gdrive_path);
                  const online =
                    m.last_seen &&
                    Date.now() - new Date(m.last_seen).getTime() < 2 * 60 * 1000;
                  const selected = machine === m.machine_name;
                  return (
                    <button
                      key={m.machine_name}
                      type="button"
                      onClick={() => setMachine(m.machine_name)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px',
                        borderRadius: 10,
                        border: `1px solid ${selected ? '#c8e600' : '#e5e7eb'}`,
                        background: selected ? '#f7fce0' : '#fff',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        transition: 'all 0.12s',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>
                          {m.machine_name}
                        </div>
                        <div style={{ fontSize: 11, color: '#8c8ca1', marginTop: 2 }}>
                          {hasCloud ? '\u2601 Cloud configured' : '\u26A0 No cloud path set'}
                          {' \u00b7 '}
                          <span style={{ color: online ? '#15803d' : '#dc2626' }}>
                            {online ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </div>
                      {selected && <span style={{ color: '#1a1a2e', fontWeight: 700 }}>{'\u2713'}</span>}
                    </button>
                  );
                })
              ) : (
                <div style={{ fontSize: 13, color: '#8c8ca1', padding: 12, textAlign: 'center' }}>
                  No machines registered yet. Install the scanner on a PC first.
                </div>
              )}
            </div>

            <div className="delete-modal-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="delete-modal-btn cancel" onClick={onClose}>Cancel</button>
              <button
                className="delete-modal-btn danger final"
                style={{ background: canAdvanceStep1 ? '#c8e600' : '#e5e7eb', color: '#1a1a2e' }}
                onClick={handleNext}
                disabled={!canAdvanceStep1}
              >
                Next {'\u2192'}
              </button>
            </div>
          </>
        )}

        {/* Step 2: drive */}
        {step === 2 && (
          <>
            <p className="delete-modal-desc" style={{ textAlign: 'left', marginBottom: 10 }}>
              Which drive should the files land on when done? Skip to just sync to the PC and decide later.
            </p>

            {spaceWarning && (
              <div className={`dp-wizard-warn ${spaceWarning.level === 'error' ? 'error' : ''}`}>
                <span>{spaceWarning.level === 'error' ? '\u26D4' : '\u26A0'}</span>
                <span>{spaceWarning.text}</span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {connectedDrives.length > 0 ? (
                connectedDrives.map((d) => {
                  const selected = drive === d.name;
                  return (
                    <button
                      key={d.name}
                      type="button"
                      onClick={() => setDrive(d.name)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px',
                        borderRadius: 10,
                        border: `1px solid ${selected ? '#c8e600' : '#e5e7eb'}`,
                        background: selected ? '#f7fce0' : '#fff',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        transition: 'all 0.12s',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>{d.name}</div>
                        <div style={{ fontSize: 11, color: '#8c8ca1', marginTop: 2 }}>
                          {formatSize(d.free)} free of {formatSize(d.total)}
                        </div>
                      </div>
                      {selected && <span style={{ color: '#1a1a2e', fontWeight: 700 }}>{'\u2713'}</span>}
                    </button>
                  );
                })
              ) : (
                <div style={{ fontSize: 13, color: '#8c8ca1', padding: 12, textAlign: 'center' }}>
                  No connected drives found. You can skip and copy later.
                </div>
              )}
            </div>

            {/* Gap 1 — optional cloud account picker. Only rendered when the
                studio has seeded accounts matching this project's link_type.
                When hidden (or when "Auto" is picked) the backend passes null
                for cloud_account_id and the scanner falls back to the PC's
                single configured cloud path — i.e. today's behavior. */}
            {showCloudPicker && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a2e', marginBottom: 6 }}>
                  Cloud account {'\u00b7'} <span style={{ fontWeight: 400, color: '#8c8ca1' }}>optional</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setCloudAccountId(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: `1px solid ${cloudAccountId === null ? '#c8e600' : '#e5e7eb'}`,
                      background: cloudAccountId === null ? '#f7fce0' : '#fff',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      textAlign: 'left',
                      transition: 'all 0.12s',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>
                        Auto {'('}PC default{')'}
                      </div>
                      <div style={{ fontSize: 11, color: '#8c8ca1', marginTop: 2 }}>
                        Use whichever cloud folder this PC is configured for
                      </div>
                    </div>
                    {cloudAccountId === null && (
                      <span style={{ color: '#1a1a2e', fontWeight: 700 }}>{'\u2713'}</span>
                    )}
                  </button>
                  {relevantCloudAccounts.map((a) => {
                    const selected = cloudAccountId === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setCloudAccountId(a.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: `1px solid ${selected ? '#c8e600' : '#e5e7eb'}`,
                          background: selected ? '#f7fce0' : '#fff',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          textAlign: 'left',
                          transition: 'all 0.12s',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>
                            {a.account_name || a.email || 'Unnamed account'}
                          </div>
                          <div style={{ fontSize: 11, color: '#8c8ca1', marginTop: 2 }}>
                            {a.account_type === 'dropbox' ? 'Dropbox' : 'Google Drive'}
                            {a.email ? ` \u00b7 ${a.email}` : ''}
                          </div>
                        </div>
                        {selected && <span style={{ color: '#1a1a2e', fontWeight: 700 }}>{'\u2713'}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="delete-modal-actions" style={{ justifyContent: 'space-between' }}>
              <button
                className="delete-modal-btn cancel"
                onClick={() => setStep(1)}
                disabled={submitting}
              >
                {'\u2190'} Back
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="delete-modal-btn cancel"
                  onClick={() => handleSubmit(true)}
                  disabled={submitting}
                  title="Download to PC only — pick a drive later"
                >
                  Skip (download to PC only)
                </button>
                <button
                  className="delete-modal-btn danger final"
                  style={{
                    background: drive && spaceWarning?.level !== 'error' ? '#c8e600' : '#e5e7eb',
                    color: '#1a1a2e',
                  }}
                  onClick={() => handleSubmit(false)}
                  disabled={!drive || submitting || spaceWarning?.level === 'error'}
                  title={spaceWarning?.level === 'error' ? spaceWarning.text : ''}
                >
                  {submitting ? 'Starting\u2026' : 'Start Download'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
