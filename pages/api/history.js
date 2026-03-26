import { getHistory } from '../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const limit = parseInt(req.query.limit) || 50;
    const activities = await getHistory(limit);
    return res.status(200).json(activities);
  } catch (err) {
    console.error('History API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
