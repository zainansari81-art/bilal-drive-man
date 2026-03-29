import { searchCouples } from '../../lib/supabase';
import { requireAuth } from '../../lib/auth';

export default requireAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const query = (req.query.q || '').trim();
    if (!query) {
      return res.status(200).json([]);
    }

    const results = await searchCouples(query);
    return res.status(200).json(results);
  } catch (err) {
    console.error('Search API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
