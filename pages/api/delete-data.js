import { supabasePost, addHistory } from '../../lib/supabase';
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

    const safeMachine = sanitizeString(machine_name);
    const safeDrive = sanitizeString(drive_label);
    const safeClient = sanitizeString(client_name);
    const safeCouple = couple_name ? sanitizeString(couple_name) : '';

    // Send delete_data command to the scanner
    const result = await supabasePost('download_commands', {
      machine_name: safeMachine,
      command: 'delete_data',
      payload: {
        drive_label: safeDrive,
        client_name: safeClient,
        couple_name: safeCouple,
      },
      status: 'pending',
    });

    // Log to history
    const folderName = safeCouple
      ? `${safeClient} / ${safeCouple}`
      : safeClient;
    await addHistory({
      volume_label: safeDrive,
      event_type: 'data_deleted',
      folder_name: folderName,
      details: `Deleted from ${safeDrive} on ${safeMachine} (moved to Trash)`,
    });

    return res.status(201).json({ success: true, command: result });
  } catch (err) {
    console.error('Delete Data API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
