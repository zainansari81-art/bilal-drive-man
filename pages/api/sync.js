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

    // Upsert drive
    const driveResult = await supabasePost('drives', {
      volume_label: drive.volume_label,
      total_size_bytes: drive.total_size_bytes || 0,
      used_bytes: drive.used_bytes || 0,
      free_bytes: drive.free_bytes || 0,
      is_connected: true,
      drive_letter: drive.drive_letter || null,
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

      for (const client of clients) {
        // Upsert client
        const clientResult = await supabasePost('clients', {
          drive_id: driveId,
          client_name: client.name,
        }, 'drive_id,client_name');
        const clientId = clientResult?.[0]?.id;
        if (!clientId) continue;

        for (const couple of client.couples || []) {
          currentCoupleKeys.add(`${clientId}:${couple.name}`);

          // Check if couple exists
          const existing = await supabaseGet(
            `couples?client_id=eq.${clientId}&couple_name=eq.${encodeURIComponent(couple.name)}`
          );

          if (existing.length > 0) {
            const old = existing[0];
            const sizeChanged = Math.abs((old.size_bytes || 0) - (couple.size || 0)) > 1024 * 1024;

            await supabasePatch(`couples?id=eq.${old.id}`, {
              size_bytes: couple.size || 0,
              file_count: couple.file_count || 0,
              last_seen: new Date().toISOString(),
              is_present: true,
            });

            if (sizeChanged) {
              await addHistory({
                drive_id: driveId,
                volume_label: drive.volume_label,
                event_type: 'size_changed',
                folder_name: `${client.name} / ${couple.name}`,
                details: `Size changed on ${drive.volume_label}`,
              });
            }
            foldersUpdated++;
          } else {
            await supabasePost('couples', {
              client_id: clientId,
              couple_name: couple.name,
              size_bytes: couple.size || 0,
              file_count: couple.file_count || 0,
              first_seen: new Date().toISOString(),
              last_seen: new Date().toISOString(),
              is_present: true,
            }, 'client_id,couple_name');

            await addHistory({
              drive_id: driveId,
              volume_label: drive.volume_label,
              event_type: 'folder_added',
              folder_name: `${client.name} / ${couple.name}`,
              details: `New couple added to ${drive.volume_label}`,
            });
            foldersAdded++;
          }
        }
      }

      // Mark removed couples
      const allClients = await supabaseGet(`clients?drive_id=eq.${driveId}`);
      for (const cl of allClients) {
        const couples = await supabaseGet(`couples?client_id=eq.${cl.id}&is_present=eq.true`);
        for (const c of couples) {
          if (!currentCoupleKeys.has(`${cl.id}:${c.couple_name}`)) {
            await supabasePatch(`couples?id=eq.${c.id}`, {
              is_present: false,
              last_seen: new Date().toISOString(),
            });

            await addHistory({
              drive_id: driveId,
              volume_label: drive.volume_label,
              event_type: 'folder_removed',
              folder_name: `${cl.client_name} / ${c.couple_name}`,
              details: `Removed from ${drive.volume_label}`,
            });
            foldersRemoved++;
          }
        }
      }
    }

    await addHistory({
      drive_id: driveId,
      volume_label: drive.volume_label,
      event_type: 'drive_connected',
      details: `Drive scanned. Added: ${foldersAdded}, Updated: ${foldersUpdated}, Removed: ${foldersRemoved}`,
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
