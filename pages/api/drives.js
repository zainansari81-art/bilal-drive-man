import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'db.json');

function readDb() {
  const raw = fs.readFileSync(dbPath, 'utf-8');
  return JSON.parse(raw);
}

function writeDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

export default function handler(req, res) {
  if (req.method === 'GET') {
    const db = readDb();
    return res.status(200).json(db.drives);
  }

  if (req.method === 'POST') {
    const db = readDb();
    const drive = req.body;

    if (drive.id) {
      const idx = db.drives.findIndex(d => d.id === drive.id);
      if (idx !== -1) {
        db.drives[idx] = { ...db.drives[idx], ...drive };
      } else {
        return res.status(404).json({ error: 'Drive not found' });
      }
    } else {
      drive.id = db.drives.length > 0 ? Math.max(...db.drives.map(d => d.id)) + 1 : 1;
      db.drives.push(drive);
    }

    writeDb(db);
    return res.status(200).json(drive);
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}
