import { useState } from 'react';
import { formatSize, formatTB } from '../lib/format';
import DeleteConfirmModal from './DeleteConfirmModal';

export default function DrivesPage({ drives }) {
  const connected = drives.filter(d => d.connected);
  const disconnected = drives.filter(d => !d.connected);

  if (drives.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c8ca1' }}>
        <p style={{ fontSize: 18 }}>No drives found yet.</p>
        <p style={{ fontSize: 14 }}>Connect an external drive and run the scanner to get started.</p>
      </div>
    );
  }

  return (
    <div>
      {connected.length > 0 && (
        <>
          <h3 style={{ color: '#22c55e', margin: '10px 0' }}>Connected ({connected.length})</h3>
          {connected.map((d, i) => <div key={i} className="scroll-reveal" style={{ transitionDelay: `${i * 60}ms` }}><DriveCard drive={d} /></div>)}
        </>
      )}
      {disconnected.length > 0 && (
        <>
          <h3 style={{ color: '#8c8ca1', margin: '20px 0 10px' }}>Disconnected ({disconnected.length})</h3>
          {disconnected.map((d, i) => <div key={i} className="scroll-reveal" style={{ transitionDelay: `${i * 60}ms` }}><DriveCard drive={d} /></div>)}
        </>
      )}
    </div>
  );
}

function DriveCard({ drive }) {
  const d = drive;
  const pct = d.total > 0 ? Math.round(d.used / d.total * 100) : 0;
  const barColor = pct < 70 ? '#22c55e' : pct < 90 ? '#eab308' : '#ef4444';
  const statusColor = d.connected ? '#22c55e' : '#ef4444';
  const statusText = d.connected ? `Connected (${d.letter})` : 'Disconnected';
  const totalCouples = d.clients ? d.clients.reduce((s, c) => s + c.couples.length, 0) : 0;
  const lowThreshold = 100 * 1024 * 1024 * 1024; // 100 GB in bytes

  return (
    <div className="drive-detail-card">
      <div className="drive-detail-top">
        <span className="drive-detail-name">{d.name}</span>
        <span className="drive-detail-status" style={{ color: statusColor }}>{statusText}</span>
      </div>
      <div className="drive-detail-meta">
        Used: {formatTB(d.used)} &nbsp;|&nbsp; Free: {formatTB(d.free)} &nbsp;|&nbsp; Total: {formatTB(d.total)} &nbsp;|&nbsp; {pct}% &nbsp;|&nbsp; {d.clients ? d.clients.length : 0} Clients, {totalCouples} Couples
      </div>
      <div className="drive-progress-bar">
        <div className="drive-progress-fill" style={{ background: barColor, width: `${pct}%` }}></div>
      </div>
      {d.free > 0 && d.free < lowThreshold && (
        <div className="low-space-warning">
          {'\u26A0'} LOW SPACE: Only {formatSize(d.free)} remaining!
        </div>
      )}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: '#1a1a2e', fontWeight: 600, marginBottom: 8 }}>
          Clients &amp; Couples ({d.clients ? d.clients.length : 0} clients, {totalCouples} couples)
        </summary>
        <div style={{ padding: '4px 0 0' }}>
          {(d.clients || []).map((client, ci) => (
            <ClientBlock key={ci} client={client} drive={d} />
          ))}
        </div>
      </details>
    </div>
  );
}

function ClientBlock({ client, drive }) {
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const clientTotal = client.couples.reduce((s, c) => s + c.size, 0);

  const handleDeleteCouple = (couple) => {
    setDeleteTarget({
      type: 'couple',
      driveName: drive.name,
      clientName: client.name,
      coupleName: couple.name,
      size: couple.size,
      sourceMachine: drive.sourceMachine,
    });
  };

  const handleDeleteClient = () => {
    setDeleteTarget({
      type: 'client',
      driveName: drive.name,
      clientName: client.name,
      coupleName: '',
      size: clientTotal,
      coupleCount: client.couples.length,
      sourceMachine: drive.sourceMachine,
    });
  };

  return (
    <div className="client-block">
      <div className="client-header" onClick={() => setOpen(!open)}>
        <div className="client-icon">{open ? '\u25BC' : '\u25B6'}</div>
        <span className="client-name">{client.name}</span>
        <span className="client-count">({client.couples.length} couples)</span>
        <span className="client-size">{formatSize(clientTotal)}</span>
        {drive.connected && (
          <button
            className="delete-btn-small"
            onClick={(e) => { e.stopPropagation(); handleDeleteClient(); }}
            title="Delete entire client folder"
          >
            {'\uD83D\uDDD1'}
          </button>
        )}
      </div>
      {open && (
        <div className="couple-list">
          {client.couples.map((couple, i) => (
            <div className="couple-row" key={i}>
              <div className="couple-dot"></div>
              <span className="couple-name">{couple.name}</span>
              <span className="couple-size">{formatSize(couple.size)}</span>
              {drive.connected && (
                <button
                  className="delete-btn-small"
                  onClick={() => handleDeleteCouple(couple)}
                  title="Delete this couple folder"
                >
                  {'\uD83D\uDDD1'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
