import crypto from 'crypto';

const AUTH_USERNAME = process.env.AUTH_USERNAME || 'bilal';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'driveman2024';
const AUTH_SECRET = process.env.AUTH_SECRET || 'bilal-drive-man-secret-key-2024';
const SYNC_API_KEY = process.env.SYNC_API_KEY || 'bilal-scanner-key-2024';

function hmacSign(payload) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
}

export function verifyCredentials(username, password) {
  return username === AUTH_USERNAME && password === AUTH_PASSWORD;
}

export function createSessionToken(username) {
  const payload = JSON.stringify({
    username,
    iat: Date.now(),
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  const encoded = Buffer.from(payload).toString('base64');
  const signature = hmacSign(encoded);
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encoded, signature] = parts;
  const expectedSig = hmacSign(encoded);
  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return verifySessionToken(cookies.session);
}

export function requireAuth(handler) {
  return async (req, res) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return handler(req, res);
  };
}

export function requireApiKey(handler) {
  return async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== SYNC_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
    }
    return handler(req, res);
  };
}

function parseCookies(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  cookieStr.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}
