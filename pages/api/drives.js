import { getDrivesWithClients, formatDrivesForFrontend, upsertDrive } from '../../lib/supabase';
import { requireAuth, sanitizeString, validatePositiveNumber } from '../../lib/auth';

export default requireAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const drives = await getDrivesWithClients();
      const formatted = await formatDrivesForFrontend(drives);
      return res.status(200).json(formatted);
    }

    if (req.method === 'POST') {
      const drive = req.body;
      const result = await upsertDrive({
        volume_label: sanitizeString(drive.name || drive.volume_label),
        total_size_bytes: validatePositiveNumber(drive.total || drive.total_size_bytes),
        used_bytes: validatePositiveNumber(drive.used || drive.used_bytes),
        free_bytes: validatePositiveNumber(drive.free || drive.free_bytes),
        is_connected: drive.connected !== undefined ? drive.connected : drive.is_connected,
        drive_letter: sanitizeString(drive.letter || drive.drive_letter || ''),
        last_seen: new Date().toISOString(),
        last_scan: new Date().toISOString(),
      });
      return res.status(200).json(result);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('Drives API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
