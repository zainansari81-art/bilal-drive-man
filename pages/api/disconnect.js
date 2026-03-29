import { addHistory, supabasePatch } from '../../lib/supabase';
import { requireApiKey, sanitizeString } from '../../lib/auth';

export default requireApiKey(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { volume_label } = req.body;
    if (!volume_label) {
      return res.status(400).json({ error: 'volume_label is required' });
    }

    const safeLabel = sanitizeString(volume_label, 128);

    await supabasePatch(`drives?volume_label=eq.${encodeURIComponent(safeLabel)}`, {
      is_connected: false,
    });

    await addHistory({
      volume_label: safeLabel,
      event_type: 'drive_disconnected',
      details: `Drive ${safeLabel} disconnected`,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Disconnect API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
