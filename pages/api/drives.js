import { getDrivesWithClients, formatDrivesForFrontend, upsertDrive } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const drives = await getDrivesWithClients();
      const formatted = await formatDrivesForFrontend(drives);
      return res.status(200).json(formatted);
    }

    if (req.method === 'POST') {
      const drive = req.body;
      const result = await upsertDrive({
        volume_label: drive.name || drive.volume_label,
        total_size_bytes: drive.total || drive.total_size_bytes || 0,
        used_bytes: drive.used || drive.used_bytes || 0,
        free_bytes: drive.free || drive.free_bytes || 0,
        is_connected: drive.connected !== undefined ? drive.connected : drive.is_connected,
        drive_letter: drive.letter || drive.drive_letter || null,
        last_seen: new Date().toISOString(),
        last_scan: new Date().toISOString(),
      });
      return res.status(200).json(result);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('Drives API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
