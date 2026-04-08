import { verifyCredentials, createSessionToken, checkLoginRateLimit } from '../../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  // Rate limiting - 5 attempts per 15 minutes
  const rateCheck = checkLoginRateLimit(ip);
  if (!rateCheck.allowed) {
    console.warn(`[SECURITY] Login rate limit exceeded for IP: ${ip}`);
    res.setHeader('Retry-After', String(rateCheck.retryAfter));
    return res.status(429).json({ error: `Too many login attempts. Try again in ${rateCheck.retryAfter} seconds.` });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const valid = await verifyCredentials(username, password);
  if (!valid) {
    console.warn(`[SECURITY] Failed login attempt for user "${username}" from IP: ${ip}`);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = createSessionToken(username);

  res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${24 * 60 * 60}`);
  console.info(`[SECURITY] Successful login for user "${username}" from IP: ${ip}`);
  return res.status(200).json({ success: true, username });
}
