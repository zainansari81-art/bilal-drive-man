import { getDb } from '../../data/store';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const db = getDb();
  return res.status(200).json(db.activities);
}
