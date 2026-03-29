import { requireAuth } from '../../lib/auth';
import { getDeviceHeartbeats } from './heartbeat';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dialxndobebudwexsubr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpYWx4bmRvYmVidWR3ZXhzdWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTcwMTYsImV4cCI6MjA5MDA5MzAxNn0.XE2b_M3uyUe5VPnon-X8fspQGnNjSPyXbis57qYQxn4';

export default requireAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const heartbeats = getDeviceHeartbeats();
  const now = Date.now();

  // Get all drives from Supabase grouped by source_machine
  const drivesRes = await fetch(`${SUPABASE_URL}/rest/v1/drives?select=volume_label,source_machine,is_connected,last_seen&order=volume_label.asc`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  const drives = await drivesRes.json();

  // Build machine list from both heartbeats and drive records
  const machines = {};

  // From drive records (historical)
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

  // From heartbeats (live status)
  for (const [name, hb] of Object.entries(heartbeats)) {
    if (!machines[name]) {
      machines[name] = { name, platform: hb.platform, isOnline: false, lastSeen: null, drives: [] };
    }
    machines[name].platform = hb.platform;
    machines[name].lastSeen = hb.lastHeartbeat;
    // Online if heartbeat was within last 30 seconds
    const age = now - new Date(hb.lastHeartbeat).getTime();
    machines[name].isOnline = age < 30000;
  }

  return res.status(200).json(Object.values(machines));
});
