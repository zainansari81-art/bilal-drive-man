const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dialxndobebudwexsubr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpYWx4bmRvYmVidWR3ZXhzdWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTcwMTYsImV4cCI6MjA5MDA5MzAxNn0.XE2b_M3uyUe5VPnon-X8fspQGnNjSPyXbis57qYQxn4';

export async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...options.headers,
  };

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${res.status} - ${err}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function supabasePost(path, body, onConflict) {
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

export async function supabasePatch(path, body) {
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

export async function getDrives() {
  return supabaseFetch('drives?order=volume_label.asc');
}

export async function getDriveById(id) {
  const rows = await supabaseFetch(`drives?id=eq.${id}`);
  return rows?.[0] || null;
}

export async function upsertDrive(drive) {
  return supabaseFetch('drives', {
    method: 'POST',
    body: drive,
    headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
  });
}

export async function getClientsForDrive(driveId) {
  return supabaseFetch(`clients?drive_id=eq.${driveId}&order=client_name.asc`);
}

export async function getCouplesForClient(clientId) {
  return supabaseFetch(`couples?client_id=eq.${clientId}&order=couple_name.asc`);
}

export async function getDrivesWithClients() {
  // Single query - fetch drives with nested clients and couples
  const drives = await supabaseFetch(
    'drives?select=*,clients(*,couples(*))&order=volume_label.asc'
  );

  for (const drive of drives) {
    drive.clients = (drive.clients || [])
      .sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''))
      .map(client => ({
        name: client.client_name,
        id: client.id,
        couples: (client.couples || [])
          .sort((a, b) => (a.couple_name || '').localeCompare(b.couple_name || ''))
          .map(c => ({
            name: c.couple_name,
            size: c.size_bytes || 0,
            fileCount: c.file_count || 0,
            isPresent: c.is_present,
            firstSeen: c.first_seen,
            lastSeen: c.last_seen,
          })),
      }));
  }

  return drives;
}

const TEMP_VOLUME_PREFIXES = ['msu-target-', 'fcpx-', 'com.apple.', '.disk_label'];

export function formatDrivesForFrontend(drives) {
  return drives
    .filter(d => {
      const name = (d.volume_label || '').toLowerCase();
      return !TEMP_VOLUME_PREFIXES.some(p => name.startsWith(p));
    })
    .map(d => ({
    id: d.id,
    name: d.volume_label,
    total: d.total_size_bytes || 0,
    used: d.used_bytes || 0,
    free: d.free_bytes || 0,
    connected: d.is_connected || false,
    lastScan: d.last_scan,
    lastSeen: d.last_seen,
    letter: d.drive_letter,
    sourceMachine: d.source_machine || null,
    clients: (d.clients || []).map(cl => ({
      ...cl,
      couples: (cl.couples || []).map(c => ({
        ...c,
        size: c.size || 0,
      })),
    })),
  }));
}

export async function searchCouples(query) {
  // Sanitize: strip PostgREST filter operators and limit length
  const q = query.replace(/'/g, "''").replace(/[(),.*\\]/g, '').slice(0, 200);
  const couples = await supabaseFetch(
    `couples?or=(couple_name.ilike.*${encodeURIComponent(q)}*)&select=*,client:clients(*,drive:drives(*))&order=couple_name.asc`
  );

  // Also search by client name
  const clientMatches = await supabaseFetch(
    `clients?client_name=ilike.*${encodeURIComponent(q)}*&select=*,drive:drives(*),couples(*)`
  );

  const results = [];
  const seen = new Set();

  // From couple name matches
  for (const c of couples || []) {
    const key = `${c.client?.drive?.volume_label}-${c.client?.client_name}-${c.couple_name}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({
        couple: c.couple_name,
        client: c.client?.client_name,
        drive: c.client?.drive?.volume_label,
        connected: c.client?.drive?.is_connected || false,
        size: c.size_bytes || 0,
      });
    }
  }

  // From client name matches
  for (const cl of clientMatches || []) {
    for (const c of cl.couples || []) {
      const key = `${cl.drive?.volume_label}-${cl.client_name}-${c.couple_name}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          couple: c.couple_name,
          client: cl.client_name,
          drive: cl.drive?.volume_label,
          connected: cl.drive?.is_connected || false,
          size: c.size_bytes || 0,
        });
      }
    }
  }

  return results;
}

export async function getHistory(limit = 50) {
  const rows = await supabaseFetch(`history?order=timestamp.desc&limit=${limit}`);
  return (rows || []).map(h => ({
    type: h.event_type,
    drive: h.volume_label || '',
    folder: h.folder_name || '',
    details: h.details || '',
    time: h.timestamp ? new Date(h.timestamp).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    }) : '',
  }));
}

export async function addHistory(entry) {
  return supabaseFetch('history', {
    method: 'POST',
    body: {
      volume_label: entry.volume_label,
      drive_id: entry.drive_id || null,
      event_type: entry.event_type,
      folder_name: entry.folder_name || null,
      details: entry.details || null,
    },
  });
}
