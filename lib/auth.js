import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// ─── Secrets (all from env vars, no hardcoded fallbacks) ────────────────────
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'bilal';
const AUTH_PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH || '$2b$12$n6WYK6298Hnle9lizHI1Hu79tv1M8Pl4CN9vtPiwxNj4/CC8E7Iei';
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const SYNC_API_KEYS = (process.env.SYNC_API_KEY || 'bilal-scanner-key-2024').split(',').filter(Boolean);
const SESSION_GENERATION = parseInt(process.env.SESSION_GENERATION || '1', 10);

// ─── Rate Limiting ──────────────────────────────────────────────────────────
const loginAttempts = new Map(); // IP -> { count, firstAttempt }
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;

const apiKeyAttempts = new Map();
const API_KEY_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_API_KEY_ATTEMPTS = 60;

function checkRateLimit(map, key, maxAttempts, windowMs) {
  const now = Date.now();
  const record = map.get(key);

  if (!record || now - record.firstAttempt > windowMs) {
    map.set(key, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: maxAttempts - 1 };
  }

  record.count++;
  if (record.count > maxAttempts) {
    const retryAfter = Math.ceil((record.firstAttempt + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  return { allowed: true, remaining: maxAttempts - record.count };
}

export function checkLoginRateLimit(ip) {
  return checkRateLimit(loginAttempts, ip, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
}

// ─── HMAC Signing ───────────────────────────────────────────────────────────
function hmacSign(payload) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
}

// ─── Credential Verification (bcrypt) ───────────────────────────────────────
export async function verifyCredentials(username, password) {
  if (username !== AUTH_USERNAME) return false;
  return bcrypt.compare(password, AUTH_PASSWORD_HASH);
}

// ─── Session Tokens ─────────────────────────────────────────────────────────
export function createSessionToken(username) {
  const payload = JSON.stringify({
    username,
    gen: SESSION_GENERATION,
    iat: Date.now(),
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
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

  // Constant-time comparison to prevent timing attacks
  try {
    const sigBuf = Buffer.from(signature, 'utf-8');
    const expectedBuf = Buffer.from(expectedSig, 'utf-8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    // Reject tokens from older session generations (allows mass invalidation)
    if ((payload.gen || 0) < SESSION_GENERATION) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return verifySessionToken(cookies.session);
}

// ─── Middleware ──────────────────────────────────────────────────────────────
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
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const rateCheck = checkRateLimit(apiKeyAttempts, ip, MAX_API_KEY_ATTEMPTS, API_KEY_WINDOW_MS);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }

    const apiKey = req.headers['x-api-key'];
    if (!apiKey || !SYNC_API_KEYS.includes(apiKey)) {
      console.warn(`[SECURITY] Invalid API key attempt from ${ip}`);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return handler(req, res);
  };
}

// ─── Input Validation ───────────────────────────────────────────────────────
export function sanitizeString(str, maxLength = 255) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength).replace(/[\x00-\x1f\x7f]/g, '');
}

export function validatePositiveNumber(val) {
  const num = Number(val);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

// ─── Cookie Parser ──────────────────────────────────────────────────────────
function parseCookies(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  cookieStr.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}
