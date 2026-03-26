import { getClientsForDrive, getCouplesForClient, getDriveById, addHistory } from '../../lib/supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dialxndobebudwexsubr.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function supabasePost(path, body, headers = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const driveId = parseInt(req.query.drive_id);
      if (!driveId) {
        return res.status(400).json({ error: 'drive_id is required' });
      }

      const drive = await getDriveById(driveId);
      if (!drive) {
        return res.status(404).json({ error: 'Drive not found' });
      }

      const clients = await getClientsForDrive(driveId);
      const result = [];
      for (const client of clients) {
        const couples = await getCouplesForClient(client.id);
        result.push({
          name: client.client_name,
          id: client.id,
          couples: couples.map(c => ({
            name: c.couple_name,
            size: c.size_bytes || 0,
            isPresent: c.is_present,
          })),
        });
      }

      return res.status(200).json({ drive: drive.volume_label, clients: result });
    }

    if (req.method === 'POST') {
      const { drive_id, client_name, couple_name, couple_size } = req.body;

      const drive = await getDriveById(drive_id);
      if (!drive) {
        return res.status(404).json({ error: 'Drive not found' });
      }

      // Upsert client
      const clientResult = await supabasePost('clients', {
        drive_id,
        client_name,
      });
      const clientId = clientResult?.[0]?.id;

      // Add couple if provided
      if (couple_name && clientId) {
        await supabasePost('couples', {
          client_id: clientId,
          couple_name,
          size_bytes: couple_size || 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          is_present: true,
        });
      }

      await addHistory({
        drive_id,
        volume_label: drive.volume_label,
        event_type: 'folder_added',
        folder_name: `${client_name}${couple_name ? ' / ' + couple_name : ''}`,
        details: `Added to ${drive.volume_label}`,
      });

      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('Folders API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
