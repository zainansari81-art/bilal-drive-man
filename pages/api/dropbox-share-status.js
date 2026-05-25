import { supabaseFetch } from '../../lib/supabase';
import { requireAuth } from '../../lib/auth';
import { getDropboxAccountForMachine } from '../../lib/dropboxAccount';

// In-memory token cache. The Dropbox access_token is good for ~4h; we cache
// for 3h to leave a safety margin. This survives across requests within a
// single Vercel function instance (cold starts will refresh).
//
// Keyed by account_index so account #1 and account #2 don't trample each
// other's tokens — checking a PC1 share right after a PC2 share would
// otherwise mint a fresh token every time.
const tokenCache = new Map();

async function getDropboxAccessToken(account) {
  if (!account) throw new Error('Dropbox OAuth env vars not configured');
  const now = Date.now();
  const cached = tokenCache.get(account.account_index);
  if (cached && now < cached.expiresAt) {
    return cached.token;
  }
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: account.refresh_token,
    client_id: account.app_key,
    client_secret: account.app_secret,
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
  // expires_in is seconds; cache for 3h to be safe.
  const expiresAt = now + Math.min((data.expires_in || 14400) - 300, 3 * 60 * 60) * 1000;
  tokenCache.set(account.account_index, { token: data.access_token, expiresAt });
  return data.access_token;
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
      `download_projects?id=eq.${projectId}&select=download_link,link_type,assigned_machine`
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

    // Route Dropbox API calls to the account that matches this project's
    // assigned machine. PC2 uses account #2; everything else stays on the
    // original (account #1). If assigned_machine isn't set yet (e.g. project
    // was just created), default to account #1 — the wizard will recheck once
    // the user picks a machine.
    const dropboxAccount = getDropboxAccountForMachine(project.assigned_machine);
    let accessToken;
    try {
      accessToken = await getDropboxAccessToken(dropboxAccount);
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
        dropbox_account_email: dropboxAccount.email,
        dropbox_account_index: dropboxAccount.account_index,
        error: 'Could not read share metadata — check the link is valid and reachable',
      });
    }

    const meta = await metaResp.json();
    const isFolder = meta['.tag'] === 'folder';
    const sharedFolderId = meta.shared_folder_id || null;
    const folderName = meta.name || null;

    // Files: scanner uses save_url separately — wizard doesn't gate them.
    if (!isFolder) {
      return res.status(200).json({
        joined: true,
        shared_folder_id: null,
        folder_name: folderName,
        link_type: 'dropbox',
        dropbox_account_email: dropboxAccount.email,
        dropbox_account_index: dropboxAccount.account_index,
        error: null,
      });
    }

    // Folder logic — TWO ways a share can be genuinely "in" the user's
    // Dropbox (i.e. the scanner's mount/copy will succeed):
    //
    //  (a) Cross-account mountable share that has ALREADY been mounted —
    //      `shared_folder_id` is present AND `sharing/get_folder_metadata`
    //      reports a `path_lower`, meaning the folder exists in Rafay's tree.
    //      A `shared_folder_id` ALONE only means the share is *mountable*,
    //      NOT that it is mounted — so we must verify before claiming joined.
    //
    //  (b) "Add to my Dropbox" via web UI on an scl share — Dropbox copies
    //      the folder into Rafay's root namespace. The link metadata stays
    //      identical (no `shared_folder_id`), so we check `files/get_metadata`
    //      against `/<folder_name>` to detect the saved copy.
    //
    // Only a verified-present folder yields `joined: true`; otherwise the
    // wizard MUST show the "Add to Dropbox" step.

    if (sharedFolderId) {
      // Verify the share is actually mounted in the account — not merely
      // mountable. A mounted shared folder has a `path_lower`.
      let mounted = false;
      try {
        const folderMetaResp = await fetch('https://api.dropboxapi.com/2/sharing/get_folder_metadata', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ shared_folder_id: sharedFolderId }),
        });
        if (folderMetaResp.ok) {
          const folderMeta = await folderMetaResp.json();
          // `path_lower` is only set when the folder is mounted in the
          // caller's Dropbox; absent for mountable-but-not-mounted shares.
          mounted = Boolean(folderMeta.path_lower);
        }
      } catch (folderMetaErr) {
        console.error('Dropbox get_folder_metadata failed:', folderMetaErr.message);
      }

      if (mounted) {
        return res.status(200).json({
          joined: true,
          shared_folder_id: sharedFolderId,
          folder_name: folderName,
          link_type: 'dropbox',
          dropbox_account_email: dropboxAccount.email,
          dropbox_account_index: dropboxAccount.account_index,
          error: null,
        });
      }
      // Not mounted yet — fall through to the name-probe below, which also
      // catches the "Add to my Dropbox" copy case. If neither matches, the
      // wizard keeps showing the join step (joined: false).
    }

    if (!folderName) {
      // Defensive: no name means we can't probe the user's tree.
      return res.status(200).json({
        joined: false,
        shared_folder_id: null,
        folder_name: null,
        link_type: 'dropbox',
        dropbox_account_email: dropboxAccount.email,
        dropbox_account_index: dropboxAccount.account_index,
        error: null,
      });
    }

    // Probe Rafay's Dropbox root for a folder with this name.
    // Dropbox saves "Add to my Dropbox" content at /<name>, BUT when a folder
    // of that name already exists Dropbox appends " (1)", " (2)", etc. So we
    // probe the exact name first, then the numbered variants — any match
    // counts as joined, and we return the ACTUAL folder name found so the
    // downstream scanner looks in the right place. (2026-05-18)
    const candidateNames = [
      folderName,
      ...[1, 2, 3, 4, 5].map(n => `${folderName} (${n})`),
    ];
    let savedInUserTree = false;
    let matchedFolderName = folderName;
    for (const candidate of candidateNames) {
      try {
        const metaProbeResp = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path: `/${candidate}` }),
        });
        if (metaProbeResp.ok) {
          const probeMeta = await metaProbeResp.json();
          if (probeMeta['.tag'] === 'folder') {
            savedInUserTree = true;
            matchedFolderName = probeMeta.name || candidate;
            break;
          }
        }
        // 409 (path/not_found) is the expected "not this variant" signal —
        // keep probing the remaining candidates.
      } catch (probeErr) {
        console.error('Dropbox get_metadata probe failed:', probeErr.message);
      }
    }

    return res.status(200).json({
      joined: savedInUserTree,
      shared_folder_id: sharedFolderId,
      // Return the matched name (e.g. "AUR NEW SONGS (1)") so the scanner's
      // find_cloud_folder substring match resolves to the right local folder.
      folder_name: matchedFolderName,
      link_type: 'dropbox',
      dropbox_account_email: dropboxAccount.email,
      dropbox_account_index: dropboxAccount.account_index,
      error: null,
    });
  } catch (err) {
    console.error('dropbox-share-status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
