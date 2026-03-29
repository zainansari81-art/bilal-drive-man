import { requireApiKey } from '../../lib/auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dialxndobebudwexsubr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpYWx4bmRvYmVidWR3ZXhzdWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTcwMTYsImV4cCI6MjA5MDA5MzAxNn0.XE2b_M3uyUe5VPnon-X8fspQGnNjSPyXbis57qYQxn4';

// In-memory store for device heartbeats (resets on cold start but that's fine)
// We also persist to Supabase drives table
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

  deviceHeartbeats[machine_name] = {
    name: machine_name,
    platform: platform || 'unknown',
    lastHeartbeat: new Date().toISOString(),
    connectedDrives: connected_drives || [],
  };

  // Update last_seen on any drives belonging to this machine
  if (connected_drives && connected_drives.length > 0) {
    for (const label of connected_drives) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/drives?volume_label=eq.${encodeURIComponent(label)}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            last_seen: new Date().toISOString(),
            is_connected: true,
            source_machine: machine_name,
          }),
        });
      } catch (e) {
        // ignore individual failures
      }
    }
  }

  return res.status(200).json({ success: true });
});
