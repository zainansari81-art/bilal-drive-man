import { requireApiKey } from '../../lib/auth';

/**
 * GET /api/scanner-credentials[?provider=dropbox|google_drive]
 *
 * Returns the OAuth credentials the scanner needs to talk to Dropbox /
 * Google Drive APIs, sourced from Vercel environment variables. Lets the
 * scanner pull credentials at startup (or on-demand) instead of relying
 * on a manual `%APPDATA%/BilalDriveMan/config.json` edit on every PC.
 *
 * Why this endpoint exists:
 *   - Vercel already has the OAuth creds for /api/dropbox-share-status
 *     and /api/gdrive-share-status (used by the wizard for share
 *     pre-validation). Today the scanner has its own *separate* copy in
 *     local config.json. That dual-config has bitten us repeatedly:
 *     wizard validates green, scanner-side download dies with "no token
 *     configured" because the local copy was never populated, was wiped
 *     by a fresh install, etc.
 *   - This endpoint is the single source of truth. Scanner fetches once
 *     at startup, merges into its in-memory config, persists to local
 *     config.json so subsequent runs work even if the network is down.
 *   - Adding a new PC: install scanner, scanner auto-pulls credentials
 *     on first launch. No manual edit required.
 *
 * Security:
 *   - Gated by `requireApiKey` (X-API-Key: SYNC_API_KEY in scanner
 *     config). Same auth mechanism as /api/sync, /api/heartbeat, etc.
 *   - Returns ONLY OAuth credentials, never AUTH_PASSWORD_HASH or
 *     AUTH_SECRET. Explicit allowlist below.
 *   - HTTPS-only via Vercel TLS. SYNC_API_KEY is shared between scanner
 *     and portal — same trust boundary as today.
 *
 * Response shape:
 *   {
 *     dropbox: { refresh_token, app_key, app_secret } | null,
 *     google_drive: { refresh_token, client_id, client_secret } | null,
 *   }
 *   Each provider is null if its env vars aren't all set on Vercel
 *   (so the scanner can fall back to local config or skip that path).
 */
export default requireApiKey(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const provider = (req.query.provider || '').toString().trim().toLowerCase();
  if (provider && !['dropbox', 'google_drive'].includes(provider)) {
    return res.status(400).json({
      error: 'Invalid provider. Use dropbox or google_drive (or omit for both).',
    });
  }

  // Build the response. Each provider is null if any of its three keys is
  // missing — that's a clearer signal to the scanner than partial creds.
  const dropbox =
    process.env.DROPBOX_REFRESH_TOKEN &&
    process.env.DROPBOX_APP_KEY &&
    process.env.DROPBOX_APP_SECRET
      ? {
          refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
          app_key: process.env.DROPBOX_APP_KEY,
          app_secret: process.env.DROPBOX_APP_SECRET,
        }
      : null;

  const google_drive =
    process.env.GDRIVE_REFRESH_TOKEN &&
    process.env.GDRIVE_CLIENT_ID &&
    process.env.GDRIVE_CLIENT_SECRET
      ? {
          refresh_token: process.env.GDRIVE_REFRESH_TOKEN,
          client_id: process.env.GDRIVE_CLIENT_ID,
          client_secret: process.env.GDRIVE_CLIENT_SECRET,
        }
      : null;

  const body =
    provider === 'dropbox'
      ? { dropbox }
      : provider === 'google_drive'
        ? { google_drive }
        : { dropbox, google_drive };

  // No-cache: credential rotations on Vercel should reach scanners on
  // their next pull, no cached-response delay.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).json(body);
});
