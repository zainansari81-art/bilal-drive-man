import { useState, useEffect } from 'react';
import { LED, Gauge, Empty, fmtBytes, fmtTB, fmtPct } from './atoms';
import DeleteConfirmModal from './DeleteConfirmModal';

function heartbeatAgo(iso) {
  if (!iso) return 'Never';
  const delta = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (delta < 60) return `${Math.round(delta)}s ago`;
  if (delta < 3600) return `${Math.round(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.round(delta / 3600)}h ago`;
  return `${Math.round(delta / 86400)}d ago`;
}

export default function DevicesPage({ drives }) {
  const [mergedMachines, setMergedMachines] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [devicesRes, machinesRes] = await Promise.all([
          fetch('/api/devices'),
          fetch('/api/machines'),
        ]);
        const devicesData = devicesRes.ok ? await devicesRes.json() : [];
        const machinesData = machinesRes.ok ? await machinesRes.json() : [];

        const byName = new Map();

        // seed from drives (for offline machines with drive history)
        for (const d of drives) {
          const nm = d.sourceMachine || 'Unknown Device';
          if (!nm || nm === 'Unknown') continue;
          if (!byName.has(nm)) {
            byName.set(nm, { name: nm, isOnline: false, lastSeen: null, scannerVersion: null, platform: 'mac' });
          }
        }

        // merge heartbeat data from /api/devices
        for (const hb of (Array.isArray(devicesData) ? devicesData : [])) {
          const nm = hb.name;
          if (!nm) continue;
          const existing = byName.get(nm) || { name: nm, platform: 'mac' };
          byName.set(nm, {
            ...existing,
            isOnline: !!hb.isOnline,
            lastSeen: hb.lastSeen || existing.lastSeen,
            scannerVersion: hb.scannerVersion || existing.scannerVersion,
          });
        }

        // merge machine config from /api/machines
        for (const m of (Array.isArray(machinesData) ? machinesData : [])) {
          const nm = m.machine_name;
          if (!nm) continue;
          const existing = byName.get(nm) || { name: nm, isOnline: false, platform: 'mac' };
          byName.set(nm, {
            ...existing,
            dropbox_path: m.dropbox_path,
            gdrive_path: m.gdrive_path,
            is_download_pc: m.is_download_pc,
            lastSeen: m.last_seen || existing.lastSeen,
          });
        }

        if (!cancelled) {
          setMergedMachines([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
        }
      } catch (err) {
        console.error('DevicesPage fetch error:', err);
      }
    };

    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [drives]);

  // Derive drive lists per machine
  const enriched = mergedMachines.map(m => {
    const mDrives = drives.filter(d => d.sourceMachine === m.name);
    const totalUsed = mDrives.filter(d => d.connected).reduce((s, d) => s + d.used, 0);
    const totalCap  = mDrives.filter(d => d.connected).reduce((s, d) => s + d.total, 0);
    return { ...m, mDrives, totalUsed, totalCap };
  });

  if (enriched.length === 0) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div className="page-title"><h1>Machines</h1></div>
          <div className="page-sub">Scanner agents on each Mac and Windows PC.</div>
        </div>
        <Empty title="No machines found" sub="Install the scanner on your Macs and Windows PCs to see them here." />
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-title"><h1>Machines</h1></div>
        <div className="page-sub">
          Scanner agents on each Mac and Windows. The download PC is the one that pulls bytes from the cloud.
        </div>
      </div>

      {enriched.map(m => (
        <MachineCard key={m.name} m={m} drives={drives} />
      ))}
    </div>
  );
}

function MachineCard({ m, drives }) {
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  return (
    <div className="machine-card">
      <div className="machine-top">
        <LED state={m.isOnline ? 'on' : 'alert'} />

        <div>
          <span className="nm">
            {m.name}
            {m.scannerVersion && <span className="ver">v{m.scannerVersion}</span>}
          </span>
        </div>

        <div className="os">{m.platform === 'win' ? 'Windows' : 'macOS'}</div>

        <div className="stat">
          <span className="l">Drives</span>
          <span className="v">
            {m.mDrives.filter(d => d.connected).length}
            <span style={{ color: 'var(--ink-mute)' }}> of {m.mDrives.length}</span>
            <span style={{ color: 'var(--ink-mute)', marginLeft: 8 }}>
              · {fmtTB(m.totalUsed)} / {fmtTB(m.totalCap)} TB
            </span>
          </span>
        </div>

        <div className="stat">
          <span className="l">Heartbeat</span>
          <span className="v">
            {m.isOnline ? heartbeatAgo(m.lastSeen) : 'Stale (> 6h)'}
          </span>
        </div>

        <div className={`role${m.is_download_pc ? ' dl' : ''}`}>
          {m.is_download_pc ? 'Download PC' : 'Scan only'}
        </div>
      </div>

      <div className="row gap-16" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--rule-soft)' }}>
        <div className="row gap-8">
          <span className="label">Dropbox</span>
          <span className="t-mono" style={{ fontSize: 12, color: m.dropbox_path ? 'var(--ink-2)' : 'var(--ink-dim)' }}>
            {m.dropbox_path || 'Not set'}
          </span>
        </div>
        <div className="row gap-8">
          <span className="label">Google Drive</span>
          <span className="t-mono" style={{ fontSize: 12, color: m.gdrive_path ? 'var(--ink-2)' : 'var(--ink-dim)' }}>
            {m.gdrive_path || 'Not set'}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => setOpen(!open)}>
          {open ? 'Collapse' : 'Show drives →'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
          {m.mDrives.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', padding: 10 }}>
              No drives reporting from this machine.
            </div>
          ) : (
            m.mDrives.map(d => {
              const pct = fmtPct(d.used, d.total);
              return (
                <div className="bay-row" key={d.id || d.name}>
                  <LED state={d.connected ? 'on' : 'off'} />
                  <div>
                    <div className="nm">{d.name}</div>
                    <div className="machine">
                      {d.letter ? `${d.letter}:\\ · ` : ''}
                      {(d.clients || []).reduce((s, c) => s + c.couples.length, 0)} couples
                    </div>
                  </div>
                  <div className="use">{fmtTB(d.used)} / {fmtTB(d.total)} TB</div>
                  <Gauge pct={pct} sm />
                  <div className="meta-2">{fmtBytes(d.free)} free</div>
                  <div className="pct">{pct}<span className="pct-sign">%</span></div>
                </div>
              );
            })
          )}

          {/* Show clients/couples for each drive */}
          {m.mDrives.filter(d => d.connected && (d.clients || []).length > 0).map(drive => (
            <DriveDetail key={drive.id || drive.name} drive={drive} />
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

function DriveDetail({ drive }) {
  const [openClients, setOpenClients] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const clients = drive.clients || [];

  const toggleClient = idx => setOpenClients(prev => ({ ...prev, [idx]: !prev[idx] }));

  if (clients.length === 0) return null;

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--rule-soft)' }}>
      <div style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 500, marginBottom: 8 }}>
        {drive.name} — client folders
      </div>
      {clients.map((client, ci) => {
        const isOpen = openClients[ci];
        const clientSize = (client.couples || []).reduce((s, c) => s + (c.size || 0), 0);
        return (
          <div key={ci} style={{ marginBottom: 6 }}>
            <button
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '6px 0', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left',
              }}
              onClick={() => toggleClient(ci)}
            >
              <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{isOpen ? '▾' : '▸'}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 500 }}>{client.name}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 4 }}>
                {(client.couples || []).length} couples · {fmtBytes(clientSize)}
              </span>
              {drive.connected && (
                <button
                  className="btn ghost sm"
                  style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--alert-fg)' }}
                  onClick={e => {
                    e.stopPropagation();
                    setDeleteTarget({
                      type: 'client',
                      driveName: drive.name,
                      clientName: client.name,
                      coupleName: '',
                      size: clientSize,
                      coupleCount: (client.couples || []).length,
                      sourceMachine: drive.sourceMachine,
                    });
                  }}
                >
                  Delete client
                </button>
              )}
            </button>
            {isOpen && (client.couples || []).map((couple, coi) => (
              <div
                key={coi}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '3px 0 3px 20px',
                  borderBottom: '1px solid var(--rule-soft)',
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ink-faint)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--ink-3)', flex: 1 }}>{couple.name}</span>
                <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{fmtBytes(couple.size || 0)}</span>
                {drive.connected && (
                  <button
                    className="btn ghost sm"
                    style={{ fontSize: 11, color: 'var(--alert-fg)' }}
                    onClick={() => setDeleteTarget({
                      type: 'couple',
                      driveName: drive.name,
                      clientName: client.name,
                      coupleName: couple.name,
                      size: couple.size || 0,
                      sourceMachine: drive.sourceMachine,
                    })}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
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
