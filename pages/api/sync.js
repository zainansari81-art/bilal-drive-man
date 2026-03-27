import { addHistory } from '../../lib/supabase';
import { requireApiKey } from '../../lib/auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dialxndobebudwexsubr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpYWx4bmRvYmVidWR3ZXhzdWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTcwMTYsImV4cCI6MjA5MDA5MzAxNn0.XE2b_M3uyUe5VPnon-X8fspQGnNjSPyXbis57qYQxn4';

async function supabasePost(path, body, onConflict) {
  const url = onConflict
    ? `${SUPABASE_URL}/rest/v1/${path}?on_conflict=${onConflict}`
    : `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Supabase POST ${path} error ${res.status}:`, text);
  }
  return text ? JSON.parse(text) : null;
}

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function supabasePatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export default requireApiKey(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { drive, clients } = req.body;

    if (!drive || !drive.volume_label) {
      return res.status(400).json({ error: 'drive.volume_label is required' });
    }

    const machineName = drive.source_machine || 'Unknown';

    // Upsert drive
    const driveResult = await supabasePost('drives', {
      volume_label: drive.volume_label,
      total_size_bytes: drive.total_size_bytes || 0,
      used_bytes: drive.used_bytes || 0,
      free_bytes: drive.free_bytes || 0,
      is_connected: true,
      drive_letter: drive.drive_letter || null,
      source_machine: drive.source_machine || null,
      last_seen: new Date().toISOString(),
      last_scan: new Date().toISOString(),
    }, 'volume_label');

    const driveId = driveResult?.[0]?.id;
    if (!driveId) {
      return res.status(500).json({ error: 'Failed to upsert drive' });
    }

    let foldersAdded = 0;
    let foldersUpdated = 0;
    let foldersRemoved = 0;

    if (clients && Array.isArray(clients)) {
      const currentCoupleKeys = new Set();

      // Batch upsert all clients at once
      const clientRows = clients.map(c => ({
        drive_id: driveId,
        client_name: c.name,
      }));
      const clientResults = await supabasePost('clients', clientRows, 'drive_id,client_name');

      // Build client name -> id map
      const clientMap = {};
      if (Array.isArray(clientResults)) {
        for (const cr of clientResults) {
          clientMap[cr.client_name] = cr.id;
        }
      }

      // Batch upsert all couples at once
      const coupleRows = [];
      const coupleInfo = []; // track client name for history
      for (const client of clients) {
        const clientId = clientMap[client.name];
        if (!clientId) continue;

        for (const couple of client.couples || []) {
          currentCoupleKeys.add(`${clientId}:${couple.name}`);
          coupleRows.push({
            client_id: clientId,
            couple_name: couple.name,
            size_bytes: couple.size || 0,
            file_count: couple.file_count || 0,
            last_seen: new Date().toISOString(),
            is_present: true,
          });
          coupleInfo.push({ clientName: client.name, coupleName: couple.name });
        }
      }

      // Get existing couples before upsert to detect changes
      const existingCouples = await supabaseGet(`couples?client_id=in.(${Object.values(clientMap).join(',')})`);
      const existingMap = {};
      for (const ec of existingCouples) {
        existingMap[`${ec.client_id}:${ec.couple_name}`] = ec;
      }

      // Upsert all couples in one batch
      if (coupleRows.length > 0) {
        // Add first_seen for new couples
        for (const row of coupleRows) {
          const key = `${row.client_id}:${row.couple_name}`;
          if (!existingMap[key]) {
            row.first_seen = new Date().toISOString();
          }
        }
        await supabasePost('couples', coupleRows, 'client_id,couple_name');
      }

      // Log history for new and changed couples
      const historyEntries = [];
      for (let i = 0; i < coupleRows.length; i++) {
        const row = coupleRows[i];
        const info = coupleInfo[i];
        const key = `${row.client_id}:${row.couple_name}`;
        const existing = existingMap[key];

        if (!existing) {
          foldersAdded++;
          historyEntries.push({
            drive_id: driveId,
            volume_label: drive.volume_label,
            event_type: 'folder_added',
            folder_name: `${info.clientName} / ${info.coupleName}`,
            details: `New couple added to ${drive.volume_label} from ${machineName}`,
          });
        } else {
          const sizeChanged = Math.abs((existing.size_bytes || 0) - (row.size_bytes || 0)) > 1024 * 1024;
          if (sizeChanged) {
            historyEntries.push({
              drive_id: driveId,
              volume_label: drive.volume_label,
              event_type: 'size_changed',
              folder_name: `${info.clientName} / ${info.coupleName}`,
              details: `Size changed on ${drive.volume_label} from ${machineName}`,
            });
          }
          foldersUpdated++;
        }
      }

      // Check for removed couples
      for (const ec of existingCouples) {
        if (ec.is_present && !currentCoupleKeys.has(`${ec.client_id}:${ec.couple_name}`)) {
          foldersRemoved++;
          // Find client name for this couple
          const clientName = Object.entries(clientMap).find(([, id]) => id === ec.client_id)?.[0] || '';
          historyEntries.push({
            drive_id: driveId,
            volume_label: drive.volume_label,
            event_type: 'folder_removed',
            folder_name: `${clientName} / ${ec.couple_name}`,
            details: `Removed from ${drive.volume_label} (${machineName})`,
          });
        }
      }

      // Mark removed couples in one batch per client
      if (foldersRemoved > 0) {
        for (const ec of existingCouples) {
          if (ec.is_present && !currentCoupleKeys.has(`${ec.client_id}:${ec.couple_name}`)) {
            await supabasePatch(`couples?id=eq.${ec.id}`, {
              is_present: false,
              last_seen: new Date().toISOString(),
            });
          }
        }
      }

      // Batch insert all history entries
      if (historyEntries.length > 0) {
        await supabasePost('history', historyEntries);
      }
    }

    // Log drive connection
    await addHistory({
      drive_id: driveId,
      volume_label: drive.volume_label,
      event_type: 'drive_connected',
      details: `Drive scanned from ${machineName}. Added: ${foldersAdded}, Updated: ${foldersUpdated}, Removed: ${foldersRemoved}`,
    });

    return res.status(200).json({
      success: true,
      drive_id: driveId,
      stats: { foldersAdded, foldersUpdated, foldersRemoved },
    });
  } catch (err) {
    console.error('Sync API error:', err);
    return res.status(500).json({ error: err.message });
  }
});
