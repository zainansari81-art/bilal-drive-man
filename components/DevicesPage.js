import { useState } from 'react';
import { formatTB, formatSize } from '../lib/format';
import DeleteConfirmModal from './DeleteConfirmModal';

export default function DevicesPage({ drives }) {
  // Group ALL drives by source_machine (so offline machines still appear)
  const machines = {};
  for (const d of drives) {
    const machine = d.sourceMachine || 'Unknown Device';
    if (!machines[machine]) {
      machines[machine] = { name: machine, allDrives: [], connectedDrives: [], totalUsed: 0, totalSize: 0 };
    }
    machines[machine].allDrives.push(d);
    if (d.connected) {
      machines[machine].connectedDrives.push(d);
      machines[machine].totalUsed += d.used || 0;
      machines[machine].totalSize += d.total || 0;
    }
  }

  const machineList = Object.values(machines).sort((a, b) => a.name.localeCompare(b.name));

  if (machineList.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c8ca1' }}>
        <p style={{ fontSize: 18 }}>No devices found yet.</p>
        <p style={{ fontSize: 14 }}>Install the scanner on your Macs and Windows PCs to see them here.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="devices-grid">
        {machineList.map((machine) => (
          <div key={machine.name} className="scroll-reveal">
            <MachineCard machine={machine} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MachineCard({ machine }) {
  const [expanded, setExpanded] = useState(false);
  const [showHardDrives, setShowHardDrives] = useState(false);
  const connectedDrives = machine.connectedDrives;
  const isOnline = connectedDrives.length > 0;
  const lastSeen = machine.allDrives.reduce((latest, d) => {
    if (!d.lastSeen) return latest;
    const t = new Date(d.lastSeen).getTime();
    return t > latest ? t : latest;
  }, 0);

  const lastSeenText = lastSeen
    ? new Date(lastSeen).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : 'Never';

  return (
    <div className="device-card">
      <div className="device-card-top">
        <div className="device-card-info">
          <div className={`device-icon ${isOnline ? 'online' : 'offline'}`}>
            {'\uD83D\uDCBB'}
          </div>
          <div>
            <div className="device-name">{machine.name}</div>
            <div className="device-lastseen">Last seen: {lastSeenText}</div>
          </div>
        </div>
        <div className={`device-status ${isOnline ? 'online' : 'offline'}`}>
          {isOnline ? 'Online' : 'Offline'}
        </div>
      </div>

      <div className="device-meta">
        {connectedDrives.length} drive{connectedDrives.length !== 1 ? 's' : ''} connected &nbsp;|&nbsp; {formatTB(machine.totalSize)} total &nbsp;|&nbsp; {formatTB(machine.totalUsed)} used
      </div>

      {connectedDrives.length > 0 && (
        <div className="device-expand-buttons">
          <button
            className={`device-expand-btn ${showHardDrives ? 'expanded' : ''}`}
            onClick={() => setShowHardDrives(!showHardDrives)}
          >
            <span className="device-expand-arrow">{showHardDrives ? '\u25B2' : '\u25BC'}</span>
            {showHardDrives ? 'Hide Hard Drives' : 'Show Hard Drives'}
          </button>
          <button
            className={`device-expand-btn ${expanded ? 'expanded' : ''}`}
            onClick={() => setExpanded(!expanded)}
          >
            <span className="device-expand-arrow">{expanded ? '\u25B2' : '\u25BC'}</span>
            {expanded ? 'Hide Clients & Couples' : 'Show Clients & Couples'}
          </button>
        </div>
      )}

      {showHardDrives && (
        <div className="device-details-panel">
          <div className="device-drives">
            {connectedDrives.map((d, i) => (
              <DeviceDriveRow key={i} drive={d} />
            ))}
          </div>
        </div>
      )}

      {expanded && (
        <div className="device-details-panel">
          {connectedDrives.map((drive, di) => (
            <DriveDetails key={di} drive={drive} />
          ))}
        </div>
      )}
    </div>
  );
}

function DriveDetails({ drive }) {
  const [openClients, setOpenClients] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const clients = drive.clients || [];
  const totalCouples = clients.reduce((s, c) => s + (c.couples || []).length, 0);

  const toggleClient = (idx) => {
    setOpenClients(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleDeleteCouple = (client, couple) => {
    setDeleteTarget({
      type: 'couple',
      driveName: drive.name,
      clientName: client.name,
      coupleName: couple.name,
      size: couple.size || 0,
      sourceMachine: drive.sourceMachine,
    });
  };

  const handleDeleteClient = (client) => {
    const clientSize = (client.couples || []).reduce((s, c) => s + (c.size || 0), 0);
    setDeleteTarget({
      type: 'client',
      driveName: drive.name,
      clientName: client.name,
      coupleName: '',
      size: clientSize,
      coupleCount: (client.couples || []).length,
      sourceMachine: drive.sourceMachine,
    });
  };

  return (
    <div className="device-drive-detail">
      <div className="device-drive-detail-header">
        <span className="device-drive-detail-name">{drive.name}</span>
        <span className="device-drive-detail-count">{clients.length} clients, {totalCouples} couples</span>
      </div>

      {clients.length === 0 && (
        <div className="device-no-data">No client data available</div>
      )}

      {clients.map((client, ci) => {
        const isOpen = openClients[ci];
        const clientSize = (client.couples || []).reduce((s, c) => s + (c.size || 0), 0);
        return (
          <div key={ci} className="device-client-block">
            <button className="device-client-header" onClick={() => toggleClient(ci)}>
              <span className="device-client-arrow">{isOpen ? '\u25BE' : '\u25B8'}</span>
              <span className="device-client-icon">{'\uD83D\uDCC1'}</span>
              <span className="device-client-name">{client.name}</span>
              <span className="device-client-count">{(client.couples || []).length} couples</span>
              <span className="device-client-size">{formatSize(clientSize)}</span>
              {drive.connected && (
                <span
                  className="delete-btn-small"
                  onClick={(e) => { e.stopPropagation(); handleDeleteClient(client); }}
                  title="Delete entire client folder"
                >
                  {'\uD83D\uDDD1'}
                </span>
              )}
            </button>

            {isOpen && (
              <div className="device-couple-list">
                {(client.couples || []).map((couple, coi) => (
                  <div key={coi} className="device-couple-row">
                    <span className="device-couple-dot"></span>
                    <span className="device-couple-name">{couple.name}</span>
                    <span className="device-couple-size">{formatSize(couple.size || 0)}</span>
                    {drive.connected && (
                      <span
                        className="delete-btn-small"
                        onClick={() => handleDeleteCouple(client, couple)}
                        title="Delete this couple folder"
                      >
                        {'\uD83D\uDDD1'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {deleteTarget && (
        <DeleteConfirmModal
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function DeviceDriveRow({ drive }) {
  const pct = drive.total > 0 ? Math.round(drive.used / drive.total * 100) : 0;
  const barColor = pct < 70 ? 'linear-gradient(135deg, #22c55e, #16a34a)' : pct < 90 ? 'linear-gradient(135deg, #f8e838, #f0dc20)' : 'linear-gradient(135deg, #ef4444, #dc2626)';
  const totalClients = drive.clients ? drive.clients.length : 0;
  const totalCouples = drive.clients ? drive.clients.reduce((s, c) => s + c.couples.length, 0) : 0;

  return (
    <div className="device-drive-row">
      <div className="device-drive-top">
        <div className="device-drive-name-row">
          <span className="device-drive-name">{drive.name}</span>
          {!drive.connected && <span className="device-drive-disconnected">(disconnected)</span>}
        </div>
        <span className="device-drive-stats">{totalClients} clients, {totalCouples} couples</span>
      </div>
      <div className="device-drive-bar-row">
        <div className="device-drive-bar">
          <div className="device-drive-bar-fill" style={{ width: `${pct}%`, background: barColor }}></div>
        </div>
        <span className="device-drive-pct">{pct}%</span>
      </div>
      <div className="device-drive-size">
        {formatSize(drive.used)} / {formatSize(drive.total)}
      </div>
    </div>
  );
}
