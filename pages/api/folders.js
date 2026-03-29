import { getClientsForDrive, getCouplesForClient, getDriveById, addHistory, supabasePost } from '../../lib/supabase';
import { requireAuth, sanitizeString, validatePositiveNumber } from '../../lib/auth';

export default requireAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const driveId = parseInt(req.query.drive_id);
      if (!driveId || driveId <= 0) {
        return res.status(400).json({ error: 'Valid drive_id is required' });
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

      if (!drive_id || !client_name) {
        return res.status(400).json({ error: 'drive_id and client_name are required' });
      }

      const safeClientName = sanitizeString(client_name, 255);
      const safeCoupleName = couple_name ? sanitizeString(couple_name, 255) : null;

      const drive = await getDriveById(drive_id);
      if (!drive) {
        return res.status(404).json({ error: 'Drive not found' });
      }

      const clientResult = await supabasePost('clients', {
        drive_id,
        client_name: safeClientName,
      });
      const clientId = clientResult?.[0]?.id;

      if (safeCoupleName && clientId) {
        await supabasePost('couples', {
          client_id: clientId,
          couple_name: safeCoupleName,
          size_bytes: validatePositiveNumber(couple_size),
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          is_present: true,
        });
      }

      await addHistory({
        drive_id,
        volume_label: drive.volume_label,
        event_type: 'folder_added',
        folder_name: `${safeClientName}${safeCoupleName ? ' / ' + safeCoupleName : ''}`,
        details: `Added to ${drive.volume_label}`,
      });

      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Folders API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
