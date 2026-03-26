import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'db.json');

function readDb() {
  return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
}

function writeDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

export default function handler(req, res) {
  if (req.method === 'GET') {
    const db = readDb();
    const driveId = parseInt(req.query.drive_id);

    if (!driveId) {
      return res.status(400).json({ error: 'drive_id is required' });
    }

    const drive = db.drives.find(d => d.id === driveId);
    if (!drive) {
      return res.status(404).json({ error: 'Drive not found' });
    }

    return res.status(200).json({
      drive: drive.name,
      clients: drive.clients,
    });
  }

  if (req.method === 'POST') {
    const db = readDb();
    const { drive_id, client_name, couple_name, couple_size } = req.body;

    const drive = db.drives.find(d => d.id === drive_id);
    if (!drive) {
      return res.status(404).json({ error: 'Drive not found' });
    }

    let client = drive.clients.find(c => c.name === client_name);
    if (!client) {
      client = { name: client_name, couples: [] };
      drive.clients.push(client);
    }

    if (couple_name) {
      const existing = client.couples.find(c => c.name === couple_name);
      if (!existing) {
        client.couples.push({ name: couple_name, size: couple_size || 0 });
      }
    }

    // Add activity
    db.activities.unshift({
      type: 'added',
      drive: drive.name,
      folder: `${client_name}${couple_name ? ' / ' + couple_name : ''}`,
      time: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }),
    });

    writeDb(db);
    return res.status(200).json({ success: true });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}
