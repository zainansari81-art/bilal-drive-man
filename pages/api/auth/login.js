import { verifyCredentials, createSessionToken } from '../../../lib/auth';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { username, password } = req.body || {};

  if (!verifyCredentials(username, password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = createSessionToken(username);

  res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`);
  return res.status(200).json({ success: true, username });
}
