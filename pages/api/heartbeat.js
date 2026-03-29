import { requireApiKey, sanitizeString } from '../../lib/auth';
import { supabasePatch } from '../../lib/supabase';

// In-memory store for device heartbeats
const deviceHeartbeats = {};

export function getDeviceHeartbeats() {
  return deviceHeartbeats;
}

export default requireApiKey(async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { machine_name, platform, connected_drives } = req.body;
  if (!machine_name) {
    return res.status(400).json({ error: 'machine_name required' });
  }

  const safeName = sanitizeString(machine_name, 128);
  const safePlatform = ['mac', 'windows'].includes(platform) ? platform : 'unknown';
  const safeDrives = Array.isArray(connected_drives)
    ? connected_drives.slice(0, 50).map(d => sanitizeString(String(d), 128))
    : [];

  deviceHeartbeats[safeName] = {
    name: safeName,
    platform: safePlatform,
    lastHeartbeat: new Date().toISOString(),
    connectedDrives: safeDrives,
  };

  // Update last_seen on any drives belonging to this machine
  for (const label of safeDrives) {
    try {
      await supabasePatch(`drives?volume_label=eq.${encodeURIComponent(label)}`, {
        last_seen: new Date().toISOString(),
        is_connected: true,
        source_machine: safeName,
      });
    } catch (e) {
      // ignore individual failures
    }
  }

  return res.status(200).json({ success: true });
});
