import { supabaseFetch } from '../../lib/supabase';
import { requireAuth } from '../../lib/auth';

/**
 * GET /api/wetransfer-share-status?project_id=<uuid>
 *
 * For WeTransfer projects: resolves the share URL (we.tl/... or
 * wetransfer.com/downloads/<id>/<token>) and confirms the transfer is
 * reachable + not expired. Unlike Dropbox, WeTransfer has no "join" or "Add
 * to my account" model — shares are anonymous, time-limited (typically 7
 * days). The wizard treats `joined: true` as "share is alive, scanner can
 * proceed with per-file direct downloads".
 *
 * Response shape:
 *   { joined: boolean, transfer_id: string|null, security_hash: string|null,
 *     file_count: number|null, total_size_bytes: number|null,
 *     expires_at: string|null, link_type: 'wetransfer' | 'other',
 *     error: string|null }
 *
 *   - joined: true means the transfer responded 200 and isn't expired.
 *     Scanner can proceed with the WeTransfer direct-download path.
 *   - For non-WeTransfer projects: returns joined=true so the wizard
 *     skips the join step entirely.
 */

// we.tl short links 302 to the canonical wetransfer.com/downloads/<id>/<sec>
// or /downloads/<id>/<recipient>/<sec> URL. The transfer page exposes a
// JSON-LD blob in <script type="application/ld+json"> with file metadata
// AND a `transfer/<id>/download` POST endpoint that returns a per-file
// download token. This endpoint just validates reachability + extracts
// the lightweight metadata; the scanner uses the same path to enumerate
// files when it stages.

function extractTransferIds(url) {
  if (!url) return null;
  // wetransfer.com/downloads/<transferId>/<securityHash>
  const m1 = url.match(
    /wetransfer\.com\/downloads\/([a-f0-9]{20,})\/([a-f0-9]{10,})/i
  );
  if (m1) {
    return { transfer_id: m1[1], security_hash: m1[2], short: false };
  }
  // wetransfer.com/downloads/<id>/<email>/<sec>
  const m2 = url.match(
    /wetransfer\.com\/downloads\/([a-f0-9]{20,})\/[^/]+\/([a-f0-9]{10,})/i
  );
  if (m2) {
    return { transfer_id: m2[1], security_hash: m2[2], short: false };
  }
  // we.tl short link — must be resolved via 302
  if (/we\.tl\//i.test(url)) {
    return { transfer_id: null, security_hash: null, short: true };
  }
  return null;
}

async function resolveShortLink(shortUrl) {
  // Follow the 302 chain until we land on a wetransfer.com/downloads URL.
  // Cap at 5 hops to avoid loops.
  let current = shortUrl;
  for (let hop = 0; hop < 5; hop++) {
    const resp = await fetch(current, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) BilalDriveMan/1.0',
      },
    });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) break;
      current = loc.startsWith('http') ? loc : new URL(loc, current).toString();
      if (/wetransfer\.com\/downloads\//i.test(current)) {
        return current;
      }
      continue;
    }
    // 200 or error — stop.
    break;
  }
  return current;
}

async function fetchTransferMetadata(transferId, securityHash) {
  // WeTransfer's public transfer-status endpoint. This is the same path the
  // browser hits to render the download page. Returns JSON with item array
  // (each item has id, name, size, content_identifier='file' or 'folder').
  // No auth required for valid public transfers.
  const url =
    `https://wetransfer.com/api/v4/transfers/${encodeURIComponent(transferId)}` +
    `/prepare-download`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) BilalDriveMan/1.0',
      Accept: 'application/json',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify({ security_hash: securityHash, intent: 'entire_transfer' }),
  });

  if (resp.status === 403 || resp.status === 404) {
    return { ok: false, status: resp.status, expired: true };
  }
  if (!resp.ok) {
    return { ok: false, status: resp.status, expired: false };
  }
  let data;
  try {
    data = await resp.json();
  } catch {
    return { ok: false, status: resp.status, expired: false };
  }
  // Normalize file_count + total_size from the response shape. WeTransfer
  // sometimes returns `items` (file/folder children) and sometimes `direct`.
  const items = Array.isArray(data.items) ? data.items : [];
  const fileCount = items.filter(
    (it) => it.content_identifier !== 'folder'
  ).length;
  const totalSize = items.reduce((acc, it) => acc + (Number(it.size) || 0), 0);
  return {
    ok: true,
    file_count: fileCount || null,
    total_size_bytes: totalSize || null,
    expires_at: data.expires_at || null,
    raw: data,
  };
}

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

    if (project.link_type !== 'wetransfer' || !project.download_link) {
      return res.status(200).json({
        joined: true,
        transfer_id: null,
        security_hash: null,
        file_count: null,
        total_size_bytes: null,
        expires_at: null,
        link_type: 'other',
        error: null,
      });
    }

    let parsed = extractTransferIds(project.download_link);
    let resolvedUrl = project.download_link;

    if (parsed && parsed.short) {
      try {
        resolvedUrl = await resolveShortLink(project.download_link);
        parsed = extractTransferIds(resolvedUrl);
      } catch (resolveErr) {
        console.error('WeTransfer short-link resolve failed:', resolveErr.message);
        return res.status(200).json({
          joined: false,
          transfer_id: null,
          security_hash: null,
          file_count: null,
          total_size_bytes: null,
          expires_at: null,
          link_type: 'wetransfer',
          error: 'Could not resolve we.tl short link — share may be expired',
        });
      }
    }

    if (!parsed || !parsed.transfer_id || !parsed.security_hash) {
      return res.status(200).json({
        joined: false,
        transfer_id: null,
        security_hash: null,
        file_count: null,
        total_size_bytes: null,
        expires_at: null,
        link_type: 'wetransfer',
        error: 'Could not extract transfer ID from share URL',
      });
    }

    const meta = await fetchTransferMetadata(
      parsed.transfer_id,
      parsed.security_hash
    );

    if (!meta.ok) {
      return res.status(200).json({
        joined: false,
        transfer_id: parsed.transfer_id,
        security_hash: parsed.security_hash,
        file_count: null,
        total_size_bytes: null,
        expires_at: null,
        link_type: 'wetransfer',
        error: meta.expired
          ? 'WeTransfer share has expired or been deleted'
          : `WeTransfer API returned ${meta.status}`,
      });
    }

    return res.status(200).json({
      joined: true,
      transfer_id: parsed.transfer_id,
      security_hash: parsed.security_hash,
      file_count: meta.file_count,
      total_size_bytes: meta.total_size_bytes,
      expires_at: meta.expires_at,
      link_type: 'wetransfer',
      error: null,
    });
  } catch (err) {
    console.error('wetransfer-share-status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
