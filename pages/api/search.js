import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'db.json');

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const query = (req.query.q || '').toLowerCase().trim();
  if (!query) {
    return res.status(200).json([]);
  }

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  const results = [];

  db.drives.forEach(drive => {
    drive.clients.forEach(client => {
      client.couples.forEach(couple => {
        if (couple.name.toLowerCase().includes(query) || client.name.toLowerCase().includes(query)) {
          results.push({
            couple: couple.name,
            client: client.name,
            drive: drive.name,
            connected: drive.connected,
            size: couple.size,
          });
        }
      });
    });
  });

  return res.status(200).json(results);
}
