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

    const drives = await supabaseFetch('drives?select=volume_label,source_machine,is_connected,last_seen&order=volume_label.asc');

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
