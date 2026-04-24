import { supabaseFetch } from '../../lib/supabase';
import { requireAuth } from '../../lib/auth';

// Google Drive OAuth credentials. Env vars on Vercel:
//   GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN
// (matches scanner's gdrive_client_id / gdrive_client_secret / gdrive_refresh_token).
const GDRIVE_CLIENT_ID = process.env.GDRIVE_CLIENT_ID;
const GDRIVE_CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
const GDRIVE_REFRESH_TOKEN = process.env.GDRIVE_REFRESH_TOKEN;

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

async function getGDriveAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && now < cachedAccessTokenExpiresAt) {
    return cachedAccessToken;
  }
  if (!GDRIVE_REFRESH_TOKEN || !GDRIVE_CLIENT_ID || !GDRIVE_CLIENT_SECRET) {
    throw new Error('Google Drive OAuth env vars not configured');
  }
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: GDRIVE_REFRESH_TOKEN,
    client_id: GDRIVE_CLIENT_ID,
    client_secret: GDRIVE_CLIENT_SECRET,
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Google token refresh failed (${resp.status}): ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  cachedAccessToken = data.access_token;
  // Cache for ~50 minutes (token lasts ~1h).
  cachedAccessTokenExpiresAt = now + Math.min((data.expires_in || 3600) - 600, 50 * 60) * 1000;
  return cachedAccessToken;
}

// Pull the file/folder ID out of a Drive share URL. Handles common shapes:
//   /file/d/<id>/view
//   /open?id=<id>
//   /drive/folders/<id>
//   /folderview?id=<id>
function extractDriveId(url) {
  if (!url) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{10,})/,
    /\/folders\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/,
    /\/d\/([a-zA-Z0-9_-]{10,})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * GET /api/gdrive-share-status?project_id=<uuid>
 *
 * For Google Drive projects: confirms our app's OAuth token can READ the
 * shared file/folder. Unlike Dropbox, Google Drive doesn't require the user
 * to "Add to my Drive" before our scanner can fetch — the API D-option (D
 * for Direct download) downloads files via files.get(alt=media) directly,
 * provided our token has access.
 *
 * Response shape:
 *   { joined: boolean, file_id: string|null, name: string|null,
 *     mime_type: string|null, link_type: 'google_drive' | 'other',
 *     error: string|null }
 *
 *   - joined: true means the API can read the shared file/folder. Scanner
 *     can proceed with direct-download flow.
 *   - For non-Google-Drive projects: returns joined=true so the wizard
 *     skips the join step entirely.
 */
export default requireAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const projectId = (req.query.project_id || '').toString().trim();
  if (!/^[a-f0-9-]{36}$/i.test(projectId)) {
    return res.status(400).json({ error: 'Invalid project_id' });
  }

  try {
    const projects = await supabaseFetch(
      `download_projects?id=eq.${projectId}&select=download_link,link_type`
    );
    const project = projects && projects[0];
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.link_type !== 'google_drive' || !project.download_link) {
      return res.status(200).json({
        joined: true,
        file_id: null,
        name: null,
        mime_type: null,
        link_type: 'other',
        error: null,
      });
    }

    const fileId = extractDriveId(project.download_link);
    if (!fileId) {
      return res.status(200).json({
        joined: false,
        file_id: null,
        name: null,
        mime_type: null,
        link_type: 'google_drive',
        error: 'Could not extract Drive file/folder ID from share URL',
      });
    }

    let accessToken;
    try {
      accessToken = await getGDriveAccessToken();
    } catch (tokenErr) {
      console.error('GDrive token error:', tokenErr.message);
      return res.status(500).json({ error: 'Google Drive auth not configured on server' });
    }

    // files.get with supportsAllDrives so shared-drive content also works.
    const metaResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
        `?fields=id,name,mimeType&supportsAllDrives=true`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    if (!metaResp.ok) {
      const errText = await metaResp.text();
      console.error('GDrive metadata error:', metaResp.status, errText.slice(0, 300));
      // 403/404: our app doesn't have access. Most common cause: the share is
      // restricted ("anyone with link can view" disabled or share scoped to
      // specific accounts that don't include ours).
      return res.status(200).json({
        joined: false,
        file_id: fileId,
        name: null,
        mime_type: null,
        link_type: 'google_drive',
        error:
          metaResp.status === 403 || metaResp.status === 404
            ? 'No access to this Drive item — check share permissions'
            : `Drive API returned ${metaResp.status}`,
      });
    }

    const meta = await metaResp.json();
    return res.status(200).json({
      joined: true,
      file_id: meta.id || fileId,
      name: meta.name || null,
      mime_type: meta.mimeType || null,
      link_type: 'google_drive',
      error: null,
    });
  } catch (err) {
    console.error('gdrive-share-status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
