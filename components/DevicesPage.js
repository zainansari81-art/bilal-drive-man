import { formatTB, formatSize } from '../lib/format';

export default function DevicesPage({ drives }) {
  // Group drives by source_machine
  const machines = {};
  for (const d of drives) {
    const machine = d.sourceMachine || 'Unknown Device';
    if (!machines[machine]) {
      machines[machine] = { name: machine, drives: [], totalUsed: 0, totalSize: 0 };
    }
    machines[machine].drives.push(d);
    machines[machine].totalUsed += d.used || 0;
    machines[machine].totalSize += d.total || 0;
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
  const connectedDrives = machine.drives.filter(d => d.connected);
  const disconnectedDrives = machine.drives.filter(d => !d.connected);
  const isOnline = connectedDrives.length > 0;
  const lastSeen = machine.drives.reduce((latest, d) => {
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
        {machine.drives.length} drive{machine.drives.length !== 1 ? 's' : ''} &nbsp;|&nbsp; Total: {formatTB(machine.totalSize)} &nbsp;|&nbsp; Used: {formatTB(machine.totalUsed)}
      </div>

      <div className="device-drives">
        {connectedDrives.map((d, i) => (
          <DeviceDriveRow key={i} drive={d} />
        ))}
        {disconnectedDrives.map((d, i) => (
          <DeviceDriveRow key={`d-${i}`} drive={d} />
        ))}
      </div>
    </div>
  );
}

function DeviceDriveRow({ drive }) {
  const pct = drive.total > 0 ? Math.round(drive.used / drive.total * 100) : 0;
  const barColor = pct < 70 ? '#22c55e' : pct < 90 ? '#eab308' : '#ef4444';
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
