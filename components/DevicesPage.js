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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
        {machineList.map((machine) => (
          <MachineCard key={machine.name} machine={machine} />
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
    <div style={{
      background: 'white',
      borderRadius: '14px',
      padding: '20px',
      border: '1px solid #e5e7eb',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '10px',
            background: isOnline ? '#f0fdf4' : '#fef2f2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px',
          }}>
            {'\uD83D\uDCBB'}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px', color: '#1a1a2e' }}>{machine.name}</div>
            <div style={{ fontSize: '12px', color: '#8c8ca1' }}>Last seen: {lastSeenText}</div>
          </div>
        </div>
        <div style={{
          padding: '4px 10px',
          borderRadius: '20px',
          fontSize: '11px',
          fontWeight: 600,
          background: isOnline ? '#f0fdf4' : '#fef2f2',
          color: isOnline ? '#22c55e' : '#ef4444',
        }}>
          {isOnline ? 'Online' : 'Offline'}
        </div>
      </div>

      <div style={{ fontSize: '13px', color: '#4a4a6a', marginBottom: '12px' }}>
        {machine.drives.length} drive{machine.drives.length !== 1 ? 's' : ''} &nbsp;|&nbsp; Total: {formatTB(machine.totalSize)} &nbsp;|&nbsp; Used: {formatTB(machine.totalUsed)}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {connectedDrives.map((d, i) => (
          <DriveRow key={i} drive={d} />
        ))}
        {disconnectedDrives.map((d, i) => (
          <DriveRow key={`d-${i}`} drive={d} />
        ))}
      </div>
    </div>
  );
}

function DriveRow({ drive }) {
  const pct = drive.total > 0 ? Math.round(drive.used / drive.total * 100) : 0;
  const barColor = pct < 70 ? '#22c55e' : pct < 90 ? '#eab308' : '#ef4444';
  const totalClients = drive.clients ? drive.clients.length : 0;
  const totalCouples = drive.clients ? drive.clients.reduce((s, c) => s + c.couples.length, 0) : 0;

  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: '10px',
      background: drive.connected ? '#f7f8fa' : '#fafafa',
      border: '1px solid #eee',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a2e' }}>{drive.name}</span>
          {!drive.connected && <span style={{ fontSize: '10px', color: '#ef4444' }}>(disconnected)</span>}
        </div>
        <span style={{ fontSize: '12px', color: '#8c8ca1' }}>{totalClients} clients, {totalCouples} couples</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ flex: 1, height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: '3px' }}></div>
        </div>
        <span style={{ fontSize: '11px', color: '#8c8ca1', minWidth: '35px', textAlign: 'right' }}>{pct}%</span>
      </div>
      <div style={{ fontSize: '11px', color: '#8c8ca1', marginTop: '4px' }}>
        {formatSize(drive.used)} / {formatSize(drive.total)}
      </div>
    </div>
  );
}
