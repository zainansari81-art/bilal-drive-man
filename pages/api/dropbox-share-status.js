import { supabaseFetch } from '../../lib/supabase';
import { requireAuth } from '../../lib/auth';

// Dropbox OAuth credentials (same BilalDriveMan app the scanner uses).
// In Vercel: DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET.
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;

// In-memory token cache. The Dropbox access_token is good for ~4h; we cache
// for 3h to leave a safety margin. This survives across requests within a
// single Vercel function instance (cold starts will refresh).
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

async function getDropboxAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && now < cachedAccessTokenExpiresAt) {
    return cachedAccessToken;
  }
  if (!DROPBOX_REFRESH_TOKEN || !DROPBOX_APP_KEY || !DROPBOX_APP_SECRET) {
    throw new Error('Dropbox OAuth env vars not configured');
  }
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: DROPBOX_REFRESH_TOKEN,
    client_id: DROPBOX_APP_KEY,
    client_secret: DROPBOX_APP_SECRET,
  });
  const resp = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Dropbox token refresh failed (${resp.status}): ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  cachedAccessToken = data.access_token;
  // expires_in is seconds; cache for 3h to be safe.
  cachedAccessTokenExpiresAt = now + Math.min((data.expires_in || 14400) - 300, 3 * 60 * 60) * 1000;
  return cachedAccessToken;
}

/**
 * GET /api/dropbox-share-status?project_id=<uuid>
 *
 * Checks whether a Dropbox share link associated with a project has been
 * "added to my Dropbox" by Rafay's account (i.e. is mountable). The wizard
 * polls this endpoint to know when the user has clicked "Add to my Dropbox"
 * in a popup, so it can auto-advance to the drive picker step.
 *
 * Response shape:
 *   { joined: boolean, shared_folder_id: string|null,
 *     folder_name: string|null, link_type: 'dropbox' | 'other',
 *     error: string|null }
 *
 *   - joined: true means scanner's mount_folder will succeed.
 *   - link_type: 'other' means the project isn't a Dropbox link, wizard
 *     should skip the join step entirely.
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

    // Non-Dropbox projects: wizard skips the join step entirely.
    if (project.link_type !== 'dropbox' || !project.download_link) {
      return res.status(200).json({
        joined: true, // not applicable; treat as "no join needed"
        shared_folder_id: null,
        folder_name: null,
        link_type: 'other',
        error: null,
      });
    }

    let accessToken;
    try {
      accessToken = await getDropboxAccessToken();
    } catch (tokenErr) {
      console.error('Dropbox token error:', tokenErr.message);
      return res.status(500).json({ error: 'Dropbox auth not configured on server' });
    }

    const metaResp = await fetch('https://api.dropboxapi.com/2/sharing/get_shared_link_metadata', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: project.download_link }),
    });

    if (!metaResp.ok) {
      const errText = await metaResp.text();
      console.error('Dropbox metadata error:', metaResp.status, errText.slice(0, 300));
      // Surface the link-type mismatches gracefully — most likely a malformed
      // or expired share URL, NOT a "not joined yet" signal.
      return res.status(200).json({
        joined: false,
        shared_folder_id: null,
        folder_name: null,
        link_type: 'dropbox',
        error: 'Could not read share metadata — check the link is valid and reachable',
      });
    }

    const meta = await metaResp.json();
    const isFolder = meta['.tag'] === 'folder';
    const sharedFolderId = meta.shared_folder_id || null;

    return res.status(200).json({
      // For folders: joined when shared_folder_id is present (means mountable).
      // For files: not applicable here (scanner uses save_url separately) —
      // treat as joined so wizard doesn't block.
      joined: isFolder ? Boolean(sharedFolderId) : true,
      shared_folder_id: sharedFolderId,
      folder_name: meta.name || null,
      link_type: 'dropbox',
      error: null,
    });
  } catch (err) {
    console.error('dropbox-share-status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
