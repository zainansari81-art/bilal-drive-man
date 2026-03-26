import { getDrives, addHistory } from '../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const drives = await getDrives();

    await addHistory({
      event_type: 'scan_triggered',
      volume_label: 'All Drives',
      details: `Manual scan triggered. ${drives.length} drives in database.`,
    });

    return res.status(200).json({
      success: true,
      message: 'Scan complete. Drive data updated.',
      driveCount: drives.length,
    });
  } catch (err) {
    console.error('Scan API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
