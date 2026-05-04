import { requireAuth } from '../../lib/auth';
import { supabaseFetch } from '../../lib/supabase';
import { getDeviceHeartbeats } from './heartbeat';

export default requireAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const heartbeats = getDeviceHeartbeats();
    const now = Date.now();

    const [drives, persistedMachines] = await Promise.all([
      supabaseFetch('drives?select=volume_label,source_machine,is_connected,last_seen&order=volume_label.asc'),
      supabaseFetch('download_machines?select=machine_name,last_seen,is_download_pc').catch(() => []),
    ]);

    const machines = {};

    for (const d of drives) {
      const name = d.source_machine || 'Unknown';
      if (!machines[name]) {
        machines[name] = { name, platform: 'unknown', isOnline: false, lastSeen: null, drives: [] };
      }
      machines[name].drives.push({
        label: d.volume_label,
        connected: d.is_connected,
        lastSeen: d.last_seen,
      });
    }

    // Merge persisted heartbeats from Supabase (covers cross-instance gaps)
    for (const m of persistedMachines || []) {
      const name = m.machine_name;
      if (!name) continue;
      if (!machines[name]) {
        machines[name] = { name, platform: 'unknown', isOnline: false, lastSeen: null, drives: [] };
      }
      if (m.last_seen) {
        const ts = new Date(m.last_seen).getTime();
        const existingTs = machines[name].lastSeen ? new Date(machines[name].lastSeen).getTime() : 0;
        if (ts > existingTs) {
          machines[name].lastSeen = m.last_seen;
          machines[name].isOnline = (now - ts) < 60000; // 60s freshness window
        }
      }
    }

    // In-memory heartbeats override (most accurate when warm instance is hot)
    for (const [name, hb] of Object.entries(heartbeats)) {
      if (!machines[name]) {
        machines[name] = { name, platform: hb.platform, isOnline: false, lastSeen: null, drives: [] };
      }
      machines[name].platform = hb.platform;
      machines[name].lastSeen = hb.lastHeartbeat;
      const age = now - new Date(hb.lastHeartbeat).getTime();
      machines[name].isOnline = age < 30000;
    }

    return res.status(200).json(Object.values(machines));
  } catch (err) {
    console.error('Devices API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
