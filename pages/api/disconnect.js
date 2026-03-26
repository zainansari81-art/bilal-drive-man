import { addHistory } from '../../lib/supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dialxndobebudwexsubr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpYWx4bmRvYmVidWR3ZXhzdWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTcwMTYsImV4cCI6MjA5MDA5MzAxNn0.XE2b_M3uyUe5VPnon-X8fspQGnNjSPyXbis57qYQxn4';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { volume_label } = req.body;
    if (!volume_label) {
      return res.status(400).json({ error: 'volume_label is required' });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/drives?volume_label=eq.${encodeURIComponent(volume_label)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({ is_connected: false }),
    });

    await addHistory({
      volume_label,
      event_type: 'drive_disconnected',
      details: `Drive ${volume_label} disconnected`,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Disconnect API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
