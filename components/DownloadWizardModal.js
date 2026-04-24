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

  // ─── Cloud-join step state ──────────────────────────────────────────────
  // Before the user picks a machine/drive, the project's Dropbox share has
  // to actually be in Rafay's Dropbox. If it isn't (e.g. the client just
  // sent a "Get link" share and never invited Rafay as a member), we need
  // the user to click "Add to my Dropbox" once. We render that step in front
  // of the existing machine/drive flow.
  //
  // joinStatus values:
  //   'checking' – initial fetch in flight
  //   'needed'   – share is reachable but Rafay isn't a member yet
  //   'joined'   – share is in Rafay's Dropbox; wizard can advance
  //   'skip'     – non-Dropbox project, or check failed in a way we don't
  //                want to block on (best-effort fallback)
  //   'error'    – share link unreadable or env not configured
  const [joinStatus, setJoinStatus] = useState('checking');
  const [joinFolderName, setJoinFolderName] = useState(null);
  const [joinErrorText, setJoinErrorText] = useState(null);
  // Tracks whether the user has clicked "Open Dropbox" at least once, so we
  // can show different copy and a re-open option on subsequent polls.
  const [popupOpened, setPopupOpened] = useState(false);
  // Holds the popup window reference so we can auto-close it on success.
  const [popupRef, setPopupRef] = useState(null);

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

  // Manual recheck message (e.g. user clicked "Added to Dropbox Done" but
  // the folder isn't visible yet from Dropbox's API). Cleared on next poll.
  const [manualCheckMessage, setManualCheckMessage] = useState(null);
  // Used to show a brief "checking..." state while a manual recheck is
  // in flight, so the button click feels responsive.
  const [manualChecking, setManualChecking] = useState(false);

  // Single-shot share-status fetch. Routes to the right backend endpoint
  // based on project.link_type. Used by both the auto-poll and the user's
  // "Added to Dropbox Done" button. Returns the parsed response so callers
  // can branch on whether the folder is detected yet.
  //
  // Dropbox: API can't auto-add to user's Dropbox, so wizard shows a popup
  //   for the user to click "Add to my Dropbox" manually. Polls until the
  //   API detects the folder in user's tree.
  // Google Drive: scanner uses direct-download via Drive API (no Drive
  //   desktop client involvement). joined=true means our app's OAuth token
  //   can READ the share — proceed straight to PC/drive picker. joined=false
  //   means access is denied (link permissions), which is an error state,
  //   not a "click to add" state.
  const fetchShareStatus = async () => {
    if (!project?.id) return null;
    const isGDrive = project?.link_type === 'google_drive';
    const isWeTransfer = project?.link_type === 'wetransfer';
    const endpoint = isGDrive
      ? 'gdrive-share-status'
      : isWeTransfer
      ? 'wetransfer-share-status'
      : 'dropbox-share-status';
    try {
      const res = await fetch(
        `/api/${endpoint}?project_id=${encodeURIComponent(project.id)}&_=${Date.now()}`
      );
      if (!res.ok) {
        setJoinStatus('error');
        setJoinErrorText(`Couldn't check share status (HTTP ${res.status})`);
        return null;
      }
      const data = await res.json();
      if (data.link_type === 'other') {
        setJoinStatus('skip');
        return data;
      }
      // Backend response shapes:
      //   Dropbox: { joined, folder_name, ... }
      //   Google Drive: { joined, name (file/folder name), mime_type, ... }
      //   WeTransfer: { joined, transfer_id, file_count, total_size_bytes, expires_at }
      setJoinFolderName(
        data.folder_name ||
          data.name ||
          (isWeTransfer && data.file_count
            ? `${data.file_count} file${data.file_count === 1 ? '' : 's'}`
            : null)
      );
      if (data.joined) {
        setJoinStatus('joined');
        try { popupRef?.close(); } catch (_) { /* may be cross-origin */ }
      } else if (isGDrive) {
        // Google Drive: joined=false means access denied. There's no manual
        // "Add to Drive" action that fixes this — the share itself needs to
        // grant access. Surface as an error with a clear message.
        setJoinStatus('error');
        setJoinErrorText(
          data.error ||
            "We can't access this Drive item. Make sure the share link is set to 'Anyone with the link can view'."
        );
      } else if (isWeTransfer) {
        // WeTransfer: joined=false means the share is unreachable (expired,
        // deleted, or invalid). No manual "join" exists for WeTransfer —
        // shares are anonymous and time-limited (~7 days).
        setJoinStatus('error');
        setJoinErrorText(
          data.error ||
            "This WeTransfer share isn't reachable. It may have expired or been removed."
        );
      } else if (data.error) {
        setJoinStatus('error');
        setJoinErrorText(data.error);
      } else {
        setJoinStatus('needed');
      }
      return data;
    } catch (err) {
      setJoinStatus('error');
      setJoinErrorText(err.message || 'Network error');
      return null;
    }
  };

  // Cloud-join check + auto-poll. Runs on mount for the project's id, then
  // polls every 3s while the user is in the 'needed' state. Stops as soon as
  // we see joined=true (folder appears in Rafay's Dropbox after the user
  // clicks "Add to my Dropbox" in the popup).
  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;

    fetchShareStatus();
    const interval = setInterval(() => {
      if (cancelled) return;
      fetchShareStatus();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Manual "Added to Dropbox Done" handler. Forces a fresh check; if the
  // folder still isn't detected, surface a friendly nudge so the user knows
  // to wait a beat (Dropbox's web action sometimes takes a few seconds to
  // propagate to the API).
  const handleConfirmAdded = async () => {
    setManualChecking(true);
    setManualCheckMessage(null);
    const data = await fetchShareStatus();
    setManualChecking(false);
    if (data && data.joined) return; // wizard auto-advances via inJoinPhase flip
    if (data && !data.joined) {
      setManualCheckMessage(
        "Folder not detected yet. Give it a few seconds (Dropbox can be slow), then click again."
      );
    }
  };

  const handleOpenDropbox = () => {
    if (!project?.download_link) return;
    setPopupOpened(true);
    // 900x720 keeps Dropbox's UI usable without dominating the screen.
    const ref = window.open(
      project.download_link,
      'dropbox_add',
      'popup,width=900,height=720'
    );
    if (!ref) {
      // Popup blocked: user has to allow popups OR open in a new tab via
      // the fallback link rendered alongside the button.
      setPopupOpened(false);
    } else {
      setPopupRef(ref);
    }
  };

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

  // While the share-join check is in progress or pending the user's action,
  // render that as the active step instead of the existing PC/drive flow.
  const inJoinPhase = joinStatus === 'checking' || joinStatus === 'needed' || joinStatus === 'error';
  const headerIcon = inJoinPhase ? '\u2601\uFE0F' : (step === 1 ? '\u{1F5A5}' : '\u{1F4BE}');
  const headerTitle = inJoinPhase
    ? 'Add to Dropbox'
    : (step === 1 ? 'Pick a PC' : 'Pick a drive');
  const headerStepLabel = inJoinPhase ? 'Step 1 of 3' : `Step ${step + 1} of 3`;

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
              {headerIcon}
            </span>
            <h3 style={{ margin: 0, fontSize: 17 }}>
              {headerTitle}
            </h3>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8c8ca1' }}>{headerStepLabel}</span>
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

        {/* Pre-step: Cloud join. Shown when the share isn't yet in Rafay's
            Dropbox. We can't auto-add via API (Dropbox doesn't expose one),
            so the user clicks Open Dropbox → adds it in a popup → we poll
            and auto-advance. */}
        {inJoinPhase && (
          <>
            {joinStatus === 'checking' && (
              <p className="delete-modal-desc" style={{ textAlign: 'left', marginTop: 16, marginBottom: 16 }}>
                Checking if this folder is already in your Dropbox...
              </p>
            )}
            {joinStatus === 'needed' && (
              <>
                <p className="delete-modal-desc" style={{ textAlign: 'left', marginTop: 16, marginBottom: 8 }}>
                  {joinFolderName ? (
                    <>
                      <strong>{joinFolderName}</strong> isn't in your Dropbox yet.
                      Click below to add it — we'll continue automatically once it's added.
                    </>
                  ) : (
                    <>
                      This folder isn't in your Dropbox yet. Click below to add it —
                      we'll continue automatically once it's added.
                    </>
                  )}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16, marginBottom: 16 }}>
                  <button
                    type="button"
                    onClick={handleOpenDropbox}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: '1px solid #1a1a2e',
                      background: '#1a1a2e',
                      color: '#c8e600',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 700,
                      fontSize: 14,
                      transition: 'all 0.12s',
                    }}
                  >
                    {popupOpened ? '\u{1F504} Re-open Dropbox' : '\u2601\uFE0F Open Dropbox'}
                  </button>
                  <a
                    href={project.download_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, color: '#8c8ca1', textAlign: 'center' }}
                  >
                    Or open in a new tab
                  </a>
                  {popupOpened && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, padding: '10px 12px', borderRadius: 8, background: '#fff7e0', border: '1px solid #f1d57a' }}>
                      <span style={{ fontSize: 13, color: '#5a4500' }}>
                        Waiting for you to click <strong>"Add to my Dropbox"</strong>...
                      </span>
                    </div>
                  )}
                  {/* Manual confirm button — for users who'd rather click
                      to advance than wait for the 3s auto-poll, or when
                      Dropbox's API is slow to reflect the add. Forces an
                      immediate share-status recheck. */}
                  <button
                    type="button"
                    onClick={handleConfirmAdded}
                    disabled={manualChecking}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: '1px solid #c8e600',
                      background: manualChecking ? '#f0f5cd' : '#c8e600',
                      color: '#1a1a2e',
                      cursor: manualChecking ? 'wait' : 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 700,
                      fontSize: 14,
                      transition: 'all 0.12s',
                      marginTop: 4,
                    }}
                  >
                    {manualChecking ? 'Checking...' : '\u2705 Added to Dropbox \u2014 Done'}
                  </button>
                  {manualCheckMessage && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, background: '#eef3ff', border: '1px solid #b9c8ed' }}>
                      <span style={{ fontSize: 12, color: '#1f3a78' }}>
                        {manualCheckMessage}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
            {joinStatus === 'error' && (
              <>
                <p className="delete-modal-desc" style={{ textAlign: 'left', marginTop: 16, marginBottom: 8 }}>
                  Couldn't check Dropbox status.
                </p>
                {joinErrorText && (
                  <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fdecea', border: '1px solid #f5c2bd', marginBottom: 16 }}>
                    <span style={{ fontSize: 12, color: '#7a1a14' }}>{joinErrorText}</span>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <a
                    href={project.download_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: '1px solid #1a1a2e',
                      background: '#1a1a2e',
                      color: '#c8e600',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 700,
                      fontSize: 14,
                      textAlign: 'center',
                      textDecoration: 'none',
                    }}
                  >
                    Open Dropbox to add manually
                  </a>
                </div>
              </>
            )}
            {/* Footer with just Cancel — Continue happens automatically once
                the poll detects joined=true. No "I added it" button: we want
                detection-driven flow, not user-claim. */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  color: '#5a5a72',
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Step 1: machine */}
        {!inJoinPhase && step === 1 && (
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
        {!inJoinPhase && step === 2 && (
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
