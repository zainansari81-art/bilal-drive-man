import { useEffect, useRef, useState } from 'react';
import DownloadingProPage from '../components/DownloadingProPage';

/**
 * End-to-end test harness for the downloading-projects flow.
 *
 * Mounts the real DownloadingProPage but installs a fetch() interceptor
 * that backs every /api/* call with an in-memory mock database. No real
 * Supabase, Notion, or scanner calls are made — safe to open in prod.
 *
 * Ships a "Scanner Simulator" side panel so you can stand in for the
 * Windows scanner: ack pending commands, advance phases (pinning →
 * syncing → copying), complete or fail a download. The real UI reacts
 * exactly as it would in production.
 *
 * Route: /download-flow-test
 */

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

function seedDb() {
  return {
    projects: [
      {
        id: uuid(),
        couple_name: 'Laura & Andrew',
        client_name: 'Bilal Weddings',
        project_date: '2026-01-18',
        download_link: 'https://www.dropbox.com/scl/fo/test-laura',
        link_type: 'dropbox',
        download_status: 'idle',
        download_phase: null,
        assigned_machine: null,
        target_drive: null,
        queue_position: null,
        progress_bytes: 0,
        cloud_folder_path: '',
        error_message: null,
        notion_page_id: 'nt_laura_andrew',
        size_gb: 85,
      },
      {
        id: uuid(),
        couple_name: 'Sara & James',
        client_name: 'Bilal Weddings',
        project_date: '2026-02-02',
        download_link: 'https://drive.google.com/drive/folders/test-sara',
        link_type: 'google_drive',
        download_status: 'idle',
        download_phase: null,
        assigned_machine: null,
        target_drive: null,
        queue_position: null,
        progress_bytes: 0,
        cloud_folder_path: '',
        error_message: null,
        notion_page_id: 'nt_sara_james',
        size_gb: 120,
      },
      {
        id: uuid(),
        couple_name: 'Priya & Ravi',
        client_name: 'Bilal Weddings',
        project_date: '2025-12-10',
        download_link: 'https://www.dropbox.com/scl/fo/test-priya',
        link_type: 'dropbox',
        download_status: 'completed',
        download_phase: null,
        assigned_machine: 'EDIT-PC-1',
        target_drive: 'Drive_A',
        queue_position: null,
        progress_bytes: 68_000_000_000,
        cloud_folder_path: 'C:\\Users\\test\\Dropbox\\Priya',
        error_message: null,
        notion_page_id: 'nt_priya_ravi',
        size_gb: 68,
        completed_at: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
    machines: [
      {
        machine_name: 'EDIT-PC-1',
        dropbox_path: 'C:\\Users\\edit\\Dropbox',
        gdrive_path: 'C:\\Users\\edit\\GoogleDrive',
        is_download_pc: true,
        last_seen: new Date().toISOString(),
      },
      {
        machine_name: 'EDIT-PC-2',
        dropbox_path: 'C:\\Users\\edit\\Dropbox',
        gdrive_path: '',
        is_download_pc: true,
        last_seen: new Date().toISOString(),
      },
    ],
    drives: [
      {
        id: 'd1', name: 'Drive_A', connected: true,
        total: 2048 * 1e9, used: 1200 * 1e9, free: 848 * 1e9,
        letter: 'D:', sourceMachine: 'EDIT-PC-1',
        lastSeen: new Date().toISOString(), lastScan: new Date().toISOString(), clients: [],
      },
      {
        id: 'd2', name: 'Drive_B', connected: true,
        total: 4096 * 1e9, used: 800 * 1e9, free: 3296 * 1e9,
        letter: 'E:', sourceMachine: 'EDIT-PC-1',
        lastSeen: new Date().toISOString(), lastScan: new Date().toISOString(), clients: [],
      },
      {
        id: 'd3', name: 'Archive_2024', connected: false,
        total: 8192 * 1e9, used: 7000 * 1e9, free: 1192 * 1e9,
        letter: 'F:', sourceMachine: 'EDIT-PC-2',
        lastSeen: new Date(Date.now() - 7 * 86400000).toISOString(), lastScan: new Date(Date.now() - 7 * 86400000).toISOString(), clients: [],
      },
    ],
    commands: [],
    events: [],
  };
}

export default function DownloadFlowTest() {
  // Kept in a ref so the fetch interceptor can mutate it without
  // restarting the interceptor on every render.
  const dbRef = useRef(seedDb());
  // Tick counter purely so the sidebar re-renders when mock DB changes.
  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);
  // Gate the DownloadingProPage render until the fetch mock is live,
  // otherwise the child's mount-time fetchProjects() hits the real API
  // and we get stuck on "Loading projects...".
  const [mockReady, setMockReady] = useState(false);

  useEffect(() => {
    const realFetch = window.fetch.bind(window);
    const db = dbRef.current;

    const log = (msg) => {
      db.events.unshift({ t: new Date().toLocaleTimeString(), msg });
      db.events = db.events.slice(0, 40);
      bump();
    };

    const jsonRes = (data, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      json: async () => data,
      text: async () => JSON.stringify(data),
    });

    const handleDownloadProjectsPost = (body) => {
      const { action } = body || {};
      const pid = body.projectId || body.id;
      const p = db.projects.find((x) => x.id === pid);
      if (!p && action !== 'queue-bulk') {
        return jsonRes({ error: 'Project not found' }, 404);
      }

      if (action === 'download_now') {
        const machine = body.assigned_machine || p.assigned_machine;
        if (!machine) {
          return jsonRes({ error: 'MACHINE_REQUIRED', message: 'Pick a PC' }, 400);
        }
        p.assigned_machine = machine;
        if (body.target_drive !== undefined) p.target_drive = body.target_drive || '';
        p.download_status = 'downloading';
        p.download_phase = null;
        p.queue_position = null;
        p.error_message = null;
        if (['dropbox', 'google_drive'].includes(p.link_type)) {
          db.commands.push({
            id: uuid(),
            machine_name: machine,
            command: 'add_to_cloud',
            project_id: p.id,
            status: 'pending',
            created_at: new Date().toISOString(),
            payload: { download_link: p.download_link, link_type: p.link_type, couple_name: p.couple_name },
          });
        }
        db.commands.push({
          id: uuid(),
          machine_name: machine,
          command: 'start_download',
          project_id: p.id,
          status: 'pending',
          created_at: new Date().toISOString(),
          payload: {
            cloud_folder_path: p.cloud_folder_path || '',
            link_type: p.link_type,
            couple_name: p.couple_name,
            client_name: p.client_name,
            target_drive: p.target_drive || '',
          },
        });
        log(`download_now ${p.couple_name} → ${machine}${p.target_drive ? ' → ' + p.target_drive : ''}`);
        return jsonRes(p);
      }

      if (action === 'queue') {
        const pos = body.position ? parseInt(body.position, 10) : (db.projects.filter((x) => x.download_status === 'queued').length + 1);
        p.download_status = 'queued';
        p.queue_position = pos;
        if (body.assigned_machine) p.assigned_machine = body.assigned_machine;
        log(`queue ${p.couple_name} @ Q${pos}`);
        return jsonRes(p);
      }

      if (action === 'pause') {
        p.download_status = 'paused';
        if (p.assigned_machine) {
          db.commands.push({ id: uuid(), machine_name: p.assigned_machine, command: 'cancel_download', project_id: p.id, status: 'pending', created_at: new Date().toISOString() });
        }
        log(`pause ${p.couple_name}`);
        return jsonRes(p);
      }

      if (action === 'resume') {
        p.download_status = 'downloading';
        if (p.assigned_machine) {
          db.commands.push({ id: uuid(), machine_name: p.assigned_machine, command: 'start_download', project_id: p.id, status: 'pending', created_at: new Date().toISOString(), payload: { target_drive: p.target_drive || '' } });
        }
        log(`resume ${p.couple_name}`);
        return jsonRes(p);
      }

      if (action === 'cancel') {
        p.download_status = 'idle';
        p.download_phase = null;
        p.queue_position = null;
        p.progress_bytes = 0;
        if (p.assigned_machine) {
          db.commands.push({ id: uuid(), machine_name: p.assigned_machine, command: 'cancel_download', project_id: p.id, status: 'pending', created_at: new Date().toISOString() });
        }
        log(`cancel ${p.couple_name}`);
        return jsonRes(p);
      }

      if (action === 'copy_to_drive') {
        p.download_status = 'copying';
        p.download_phase = 'copying';
        if (p.assigned_machine) {
          db.commands.push({ id: uuid(), machine_name: p.assigned_machine, command: 'copy_to_drive', project_id: p.id, status: 'pending', created_at: new Date().toISOString(), payload: { target_drive: p.target_drive || '' } });
        }
        log(`copy_to_drive ${p.couple_name}`);
        return jsonRes(p);
      }

      if (action === 'update') {
        const allowed = ['couple_name', 'client_name', 'project_date', 'size_gb', 'target_drive', 'download_link', 'download_status', 'assigned_machine', 'cloud_folder_path'];
        for (const [k, v] of Object.entries(body.fields || {})) {
          if (allowed.includes(k)) p[k] = v;
        }
        return jsonRes(p);
      }

      if (action === 'set-target') {
        p.target_drive = body.targetDrive || '';
        return jsonRes(p);
      }

      return jsonRes({ error: 'Unknown action ' + action }, 400);
    };

    const mockFetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init?.method || 'GET').toUpperCase();
      let body = null;
      if (init?.body) {
        try { body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; }
        catch { body = null; }
      }

      // Only intercept the download / machine / drives / notion endpoints.
      // Everything else (Next's HMR, Lottie assets, etc.) hits the real network.
      if (url.startsWith('/api/download-projects')) {
        if (method === 'GET') return jsonRes({ projects: db.projects });
        if (method === 'POST') return handleDownloadProjectsPost(body);
      }
      if (url.startsWith('/api/download-commands')) {
        if (method === 'GET') {
          const qs = url.split('?')[1] || '';
          const params = new URLSearchParams(qs);
          const machine = params.get('machine');
          const status = (params.get('status') || 'pending').replace(/^eq\./, '');
          const matches = db.commands.filter((c) => (!machine || c.machine_name === machine) && c.status === status);
          return jsonRes(matches);
        }
        if (method === 'POST') {
          const cmd = { id: uuid(), status: 'pending', created_at: new Date().toISOString(), ...body };
          db.commands.push(cmd);
          return jsonRes(cmd);
        }
        if (method === 'PATCH') {
          const c = db.commands.find((x) => x.id === (body?.commandId || body?.id));
          if (c) Object.assign(c, body);
          return jsonRes(c || { success: true });
        }
      }
      if (url.startsWith('/api/download-progress')) {
        if (method === 'POST') {
          const p = db.projects.find((x) => x.id === body.project_id);
          if (p) {
            if (body.progress_bytes != null) p.progress_bytes = body.progress_bytes;
            if (body.status) p.download_status = body.status;
            if (body.phase !== undefined) p.download_phase = body.phase;
            if (body.error_message !== undefined) p.error_message = body.error_message;
            if (body.status === 'completed') {
              p.completed_at = new Date().toISOString();
              // Auto-chain: find a queued project on the same machine
              const next = db.projects.find((x) => x.download_status === 'queued' && x.assigned_machine === p.assigned_machine);
              if (next) {
                next.download_status = 'downloading';
                next.queue_position = null;
                db.commands.push({ id: uuid(), machine_name: next.assigned_machine, command: 'start_download', project_id: next.id, status: 'pending', created_at: new Date().toISOString(), payload: { target_drive: next.target_drive || '' } });
                log(`auto-chain → ${next.couple_name}`);
              }
            }
            log(`progress ${p.couple_name} status=${p.download_status} phase=${p.download_phase || '—'}`);
          }
          return jsonRes({ success: true });
        }
      }
      if (url.startsWith('/api/machines')) {
        return jsonRes(db.machines);
      }
      if (url.startsWith('/api/drives')) {
        return jsonRes(db.drives);
      }
      if (url.startsWith('/api/notion-sync')) {
        return jsonRes({ synced: db.projects.length, total: db.projects.length, errors: [] });
      }
      if (url.startsWith('/api/history')) {
        return jsonRes([]);
      }
      if (url.startsWith('/api/devices')) {
        return jsonRes([]);
      }

      return realFetch(input, init);
    };

    window.fetch = mockFetch;
    setMockReady(true);
    return () => { window.fetch = realFetch; };
  }, []);

  const db = dbRef.current;

  // Scanner simulator action helpers
  const scannerAck = (c) => {
    c.status = 'acked';
    bump();
  };
  const scannerCompleteCommand = (c) => {
    c.status = 'completed';
    bump();
  };
  const scannerProgress = async (projectId, patch) => {
    await window.fetch('/api/download-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, ...patch }),
    });
    bump();
  };

  const advanceThroughPhases = async (p) => {
    const steps = [
      { phase: 'pinning', status: 'downloading', delay: 700 },
      { phase: 'syncing', status: 'downloading', progress_bytes: Math.floor((p.size_gb || 50) * 1_000_000_000 * 0.5), delay: 900 },
      { phase: 'syncing', status: 'downloading', progress_bytes: (p.size_gb || 50) * 1_000_000_000, delay: 900 },
    ];
    if (p.target_drive) {
      steps.push({ phase: 'copying', status: 'copying', delay: 900 });
    }
    steps.push({ phase: null, status: 'completed', delay: 400 });

    for (const step of steps) {
      const { delay, ...patch } = step;
      await scannerProgress(p.id, patch);
      await new Promise((r) => setTimeout(r, delay));
    }
  };

  const resetDb = () => {
    // Mutate the existing dbRef.current in place so the fetch interceptor
    // (which closed over `db` at mount time) sees the fresh data.
    const fresh = seedDb();
    const current = dbRef.current;
    Object.keys(current).forEach((k) => { delete current[k]; });
    Object.assign(current, fresh);
    bump();
  };

  return (
    <div className="cleaner-layout" style={{ background: '#0b0818', minHeight: '100vh' }}>
      <style>{bannerCss}</style>
      <div className="test-banner">
        <span className="test-banner-dot" />
        <div>
          <strong>Download-flow test harness</strong>{' '}
          <span style={{ opacity: 0.8 }}>
            — all /api calls are mocked. Real scanner and Supabase untouched.
          </span>
        </div>
        <button className="test-banner-reset" onClick={resetDb}>Reset mock DB</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 0, alignItems: 'flex-start' }}>
        <main className="cleaner-main" style={{ padding: '20px 32px 40px' }}>
          <h1 style={{ color: '#fff', margin: '12px 0 20px', fontSize: 22 }}>
            Downloading Projects (mock)
          </h1>
          {mockReady ? (
            <DownloadingProPage drives={db.drives} />
          ) : (
            <div style={{ color: '#8c8ca1', padding: 40, textAlign: 'center' }}>
              Installing fetch interceptor…
            </div>
          )}
        </main>

        <aside className="test-sidebar">
          <h3>Scanner simulator</h3>
          <p className="test-hint">
            Stand in for the Windows scanner. Pending commands accumulate as the
            UI fires them — ack them, then walk through the phases to see the
            main page react in real time.
          </p>

          <div className="test-section-title">Machines</div>
          {db.machines.map((m) => {
            const online = m.last_seen && Date.now() - new Date(m.last_seen).getTime() < 2 * 60 * 1000;
            return (
              <div key={m.machine_name} className="test-machine">
                <span className="test-machine-dot" style={{ background: online ? '#22c55e' : '#6b7280' }} />
                <strong>{m.machine_name}</strong>
                <span style={{ opacity: 0.7, fontSize: 11 }}>{m.dropbox_path || m.gdrive_path}</span>
              </div>
            );
          })}

          <div className="test-section-title">Pending commands ({db.commands.filter((c) => c.status === 'pending').length})</div>
          {db.commands.filter((c) => c.status === 'pending').length === 0 && (
            <div className="test-empty">No pending work.</div>
          )}
          {db.commands.filter((c) => c.status === 'pending').map((c) => {
            const p = db.projects.find((x) => x.id === c.project_id);
            return (
              <div key={c.id} className="test-cmd">
                <div className="test-cmd-head">
                  <span className={`test-cmd-tag test-cmd-${c.command}`}>{c.command}</span>
                  <span style={{ opacity: 0.85, fontSize: 12 }}>{p?.couple_name || c.project_id}</span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.65 }}>machine: {c.machine_name}</div>
                <div className="test-cmd-actions">
                  <button onClick={() => scannerAck(c)}>Ack</button>
                  <button onClick={() => scannerCompleteCommand(c)}>Complete</button>
                </div>
              </div>
            );
          })}

          <div className="test-section-title">Active projects</div>
          {db.projects.filter((p) => ['downloading', 'copying', 'queued', 'paused'].includes(p.download_status)).length === 0 && (
            <div className="test-empty">No active projects. Click "Download" on an idle row.</div>
          )}
          {db.projects.filter((p) => ['downloading', 'copying', 'queued', 'paused'].includes(p.download_status)).map((p) => (
            <div key={p.id} className="test-active">
              <div style={{ fontWeight: 600 }}>{p.couple_name}</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                {p.download_status} · phase: {p.download_phase || '—'} · {p.assigned_machine || '(no machine)'} · {p.target_drive || '(no drive)'}
              </div>
              <div className="test-cmd-actions" style={{ flexWrap: 'wrap' }}>
                <button onClick={() => scannerProgress(p.id, { phase: 'pinning', status: 'downloading' })}>Pin</button>
                <button onClick={() => scannerProgress(p.id, { phase: 'syncing', status: 'downloading', progress_bytes: Math.floor((p.size_gb || 50) * 1_000_000_000 * 0.5) })}>Sync 50%</button>
                <button onClick={() => scannerProgress(p.id, { phase: 'syncing', status: 'downloading', progress_bytes: (p.size_gb || 50) * 1_000_000_000 })}>Sync 100%</button>
                {p.target_drive && (
                  <button onClick={() => scannerProgress(p.id, { phase: 'copying', status: 'copying' })}>Copy</button>
                )}
                <button onClick={() => scannerProgress(p.id, { phase: null, status: 'completed' })}>Complete</button>
                <button onClick={() => scannerProgress(p.id, { status: 'failed', error_message: 'Simulated scanner error' })} className="test-btn-danger">Fail</button>
                <button onClick={() => advanceThroughPhases(p)} className="test-btn-primary">Auto walk →</button>
              </div>
            </div>
          ))}

          <div className="test-section-title">Event log</div>
          <div className="test-events">
            {db.events.length === 0 ? <div className="test-empty">No events yet.</div> :
              db.events.map((e, i) => (
                <div key={i} className="test-event">
                  <span style={{ opacity: 0.5 }}>{e.t}</span> {e.msg}
                </div>
              ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

const bannerCss = `
  .test-banner { display:flex; align-items:center; gap:12px; padding:10px 20px; background:linear-gradient(90deg,#7c3aed33,#a855f71a); color:#fff; font-size:13px; border-bottom:1px solid #4a3070; }
  .test-banner-dot { width:10px; height:10px; border-radius:50%; background:#a855f7; box-shadow:0 0 10px #a855f7; flex-shrink:0; }
  .test-banner-reset { margin-left:auto; padding:6px 12px; background:rgba(168,85,247,0.25); border:1px solid #7c3aed; color:#fff; border-radius:6px; font-size:12px; cursor:pointer; }
  .test-sidebar { position:sticky; top:0; max-height:100vh; overflow-y:auto; padding:20px; background:#120a24; border-left:1px solid #2a1a48; color:#ddd; font-family:ui-sans-serif,system-ui,sans-serif; }
  .test-sidebar h3 { margin:0 0 8px; color:#fff; font-size:15px; }
  .test-hint { font-size:12px; opacity:0.7; line-height:1.4; margin:0 0 12px; }
  .test-section-title { margin:16px 0 8px; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; opacity:0.6; }
  .test-empty { font-size:12px; opacity:0.5; font-style:italic; }
  .test-machine { display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #1e1232; font-size:13px; }
  .test-machine-dot { width:8px; height:8px; border-radius:50%; }
  .test-cmd { background:#1a0f2e; padding:8px 10px; margin:6px 0; border-radius:6px; border:1px solid #2a1a48; }
  .test-cmd-head { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
  .test-cmd-tag { padding:2px 6px; border-radius:3px; font-size:10px; font-weight:600; background:#3730a3; color:#fff; text-transform:uppercase; letter-spacing:0.05em; }
  .test-cmd-tag.test-cmd-add_to_cloud { background:#1e40af; }
  .test-cmd-tag.test-cmd-start_download { background:#15803d; }
  .test-cmd-tag.test-cmd-copy_to_drive { background:#c2410c; }
  .test-cmd-tag.test-cmd-cancel_download { background:#b91c1c; }
  .test-cmd-actions { display:flex; gap:4px; margin-top:6px; }
  .test-cmd-actions button { padding:4px 8px; font-size:11px; background:#2a1a48; border:1px solid #4a3070; color:#fff; border-radius:4px; cursor:pointer; }
  .test-cmd-actions button:hover { background:#3a2358; }
  .test-btn-primary { background:#7c3aed !important; border-color:#a855f7 !important; }
  .test-btn-danger { background:#7f1d1d !important; border-color:#dc2626 !important; }
  .test-active { background:#0f1a2e; padding:8px 10px; margin:6px 0; border-radius:6px; border:1px solid #1e3a5f; }
  .test-events { max-height:200px; overflow-y:auto; font-family:ui-monospace,SFMono-Regular,monospace; font-size:11px; }
  .test-event { padding:3px 0; border-bottom:1px dashed #2a1a48; }
  .cleaner-main { color:#fff; }
`;
