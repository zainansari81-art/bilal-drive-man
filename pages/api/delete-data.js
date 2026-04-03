import { supabasePost } from '../../lib/supabase';
import { requireAuth, sanitizeString } from '../../lib/auth';

export default requireAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { machine_name, drive_label, client_name, couple_name } = req.body;

    if (!machine_name || !drive_label || !client_name) {
      return res.status(400).json({ error: 'Missing required fields: machine_name, drive_label, client_name' });
    }

    // Send delete_data command to the scanner
    const result = await supabasePost('download_commands', {
      machine_name: sanitizeString(machine_name),
      command: 'delete_data',
      payload: {
        drive_label: sanitizeString(drive_label),
        client_name: sanitizeString(client_name),
        couple_name: couple_name ? sanitizeString(couple_name) : '',
      },
      status: 'pending',
    });

    return res.status(201).json({ success: true, command: result });
  } catch (err) {
    console.error('Delete Data API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});
