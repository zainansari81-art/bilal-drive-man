import { requireApiKey, sanitizeString } from '../../lib/auth';
import { supabaseFetch, supabasePatch, supabasePost } from '../../lib/supabase';
import { DOWNLOADING_ENABLED } from '../../lib/features';

// In-memory store for device heartbeats
const deviceHeartbeats = {};

export function getDeviceHeartbeats() {
  return deviceHeartbeats;
}

export default requireApiKey(async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { machine_name, platform, connected_drives, is_download_pc, dropbox_path, gdrive_path, scanner_version, include_commands } = req.body;
  if (!machine_name) {
    return res.status(400).json({ error: 'machine_name required' });
  }

  const safeName = sanitizeString(machine_name, 128);
  const safePlatform = ['mac', 'windows'].includes(platform) ? platform : 'unknown';
  const safeDrives = Array.isArray(connected_drives)
    ? connected_drives.slice(0, 50).map(d => sanitizeString(String(d), 128))
    : [];
  const safeVersion = scanner_version ? sanitizeString(String(scanner_version), 32) : null;

  deviceHeartbeats[safeName] = {
    name: safeName,
    platform: safePlatform,
    lastHeartbeat: new Date().toISOString(),
    connectedDrives: safeDrives,
    scannerVersion: safeVersion,
  };

  // Update last_seen on any drives belonging to this machine — one PATCH
  // for all of them, returning nothing (was one PATCH per drive, each
  // echoing the full row back = wasted Supabase egress every heartbeat).
  if (safeDrives.length > 0) {
    const labelList = safeDrives
      .map(label => `"${label.replace(/"/g, '\\"')}"`)
      .join(',');
    try {
      await supabasePatch(
        `drives?volume_label=in.(${encodeURIComponent(labelList)})`,
        {
          last_seen: new Date().toISOString(),
          is_connected: true,
          source_machine: safeName,
        },
        { returning: 'minimal' }
      );
    } catch (e) {
      console.error(`Heartbeat drive update failed for ${safeName}:`, e.message);
    }
  }

  // Persist EVERY heartbeat to download_machines so devices show up reliably
  // across Vercel serverless instances (in-memory store alone is unreliable).
  // 2026-05-04: previously gated on is_download_pc/cloud-paths — that meant
  // any Mac without a drive plugged in was invisible on the Devices page.
  try {
    await supabasePost('download_machines', {
      machine_name: safeName,
      is_download_pc: !!is_download_pc,
      dropbox_path: sanitizeString(dropbox_path || '', 500),
      gdrive_path: sanitizeString(gdrive_path || '', 500),
      last_seen: new Date().toISOString(),
    }, 'machine_name', { returning: 'minimal' });
  } catch (e) {
    // Best-effort — the device still shows via the in-memory store.
    console.error(`Heartbeat machine upsert failed for ${safeName}:`, e.message);
  }

  // v3.50.0 Mac / v3.56.0 Windows: return pending download commands in the
  // heartbeat response so the scanner makes ONE request per loop instead of
  // heartbeat + GET /api/download-commands (halves scanner invocations).
  // Same query as download-commands GET. commands=null on failure tells the
  // scanner to fall back to the separate GET.
  if (include_commands) {
    // Transfers archived (lib/features.js): nothing can queue commands, so
    // answer "none" without touching the database.
    if (!DOWNLOADING_ENABLED) {
      return res.status(200).json({ success: true, commands: [] });
    }
    let commands = null;
    try {
      commands = await supabaseFetch(
        `download_commands?machine_name=eq.${encodeURIComponent(safeName)}&status=eq.pending&order=created_at.asc`
      ) || [];
    } catch (e) {
      console.error(`Heartbeat command fetch failed for ${safeName}:`, e.message);
    }
    return res.status(200).json({ success: true, commands });
  }

  return res.status(200).json({ success: true });
});
