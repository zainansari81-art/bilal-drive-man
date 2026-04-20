import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatSize } from '../lib/format';

export default function DeleteConfirmModal({ target, onClose, onDeleted }) {
  // step: 1 = first confirm, 2 = second confirm, 3 = trash animation, 4 = error
  const [step, setStep] = useState(1);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isClient = target.type === 'client';
  const label = isClient
    ? `${target.clientName} (${target.coupleCount} couples)`
    : `${target.clientName} / ${target.coupleName}`;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch('/api/delete-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_name: target.sourceMachine,
          drive_label: target.driveName,
          client_name: target.clientName,
          couple_name: target.coupleName || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');

      // Hand off to the trash animation
      setStep(3);

      // When animation finishes, notify parent so it can hide the row,
      // then close this modal.
      setTimeout(() => {
        if (onDeleted) {
          onDeleted({
            driveName: target.driveName,
            clientName: target.clientName,
            coupleName: target.coupleName || '',
            type: target.type,
          });
        }
        onClose();
      }, 2000);
    } catch (err) {
      setErrorMsg(err.message);
      setStep(4);
    } finally {
      setDeleting(false);
    }
  };

  // Lock body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Disable overlay-click-to-close while the animation is playing
  const handleOverlayClick = step === 3 ? undefined : onClose;

  const modal = (
    <div className="delete-modal-overlay" onClick={handleOverlayClick}>
      {step === 3 ? (
        <div className="trash-anim-wrap" onClick={(e) => e.stopPropagation()}>
          <div className="trash-anim-bin">{'\uD83D\uDDD1'}</div>
          <div className="trash-anim-card">
            <span className="trash-anim-card-icon">{'\uD83D\uDCC1'}</span>
            <span className="trash-anim-card-name">{label}</span>
          </div>
        </div>
      ) : (
        <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
          {step === 4 ? (
            <>
              <div className="delete-modal-icon error">{'\u274C'}</div>
              <h3>Delete failed</h3>
              <p className="delete-modal-desc">{errorMsg}</p>
              <button className="delete-modal-btn done" onClick={onClose}>Close</button>
            </>
          ) : step === 1 ? (
            <>
              <div className="delete-modal-icon warn">{'\uD83D\uDDD1'}</div>
              <h3>Delete {isClient ? 'client' : 'couple'}?</h3>
              <p className="delete-modal-desc">
                This will move <strong>{label}</strong> from <strong>{target.driveName}</strong> to Trash / Recycle Bin.
              </p>
              <div className="delete-modal-detail">
                <div className="delete-modal-detail-row">
                  <span>Drive</span><span>{target.driveName}</span>
                </div>
                <div className="delete-modal-detail-row">
                  <span>Client</span><span>{target.clientName}</span>
                </div>
                {target.coupleName && (
                  <div className="delete-modal-detail-row">
                    <span>Couple</span><span>{target.coupleName}</span>
                  </div>
                )}
                <div className="delete-modal-detail-row">
                  <span>Size</span><span>{formatSize(target.size)}</span>
                </div>
                <div className="delete-modal-detail-row">
                  <span>Machine</span><span>{target.sourceMachine}</span>
                </div>
              </div>
              <div className="delete-modal-actions">
                <button className="delete-modal-btn cancel" onClick={onClose}>Cancel</button>
                <button className="delete-modal-btn danger" onClick={() => setStep(2)}>
                  Yes, delete
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="delete-modal-icon danger">{'\u26A0'}</div>
              <h3>Are you absolutely sure?</h3>
              <p className="delete-modal-desc">
                <strong>{label}</strong> ({formatSize(target.size)}) will be moved to Trash / Recycle Bin on <strong>{target.sourceMachine}</strong>. You can restore it from there if needed.
              </p>
              <div className="delete-modal-actions">
                <button className="delete-modal-btn cancel" onClick={onClose}>No, go back</button>
                <button
                  className="delete-modal-btn danger final"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Sending...' : 'Confirm delete'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );

  // Render via portal to document.body so position:fixed always works
  if (typeof window === 'undefined') return modal;
  return createPortal(modal, document.body);
}
