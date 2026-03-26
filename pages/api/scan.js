import { getDb, saveDb } from '../../data/store';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const db = getDb();

  db.drives.forEach(drive => {
    let totalUsed = 0;
    drive.clients.forEach(client => {
      client.couples.forEach(couple => {
        totalUsed += couple.size;
      });
    });
    drive.used = totalUsed;
    drive.free = drive.total - totalUsed;
  });

  db.activities.unshift({
    type: 'connected',
    drive: 'All Drives',
    folder: '',
    time: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }),
  });

  saveDb(db);

  return res.status(200).json({
    success: true,
    message: 'Scan complete. Drive data updated.',
    drives: db.drives,
  });
}
