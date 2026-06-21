import { supabaseFetch, supabasePost } from '../../lib/supabase';
import { requireApiKey, requireAuthOrApiKey, sanitizeString } from '../../lib/auth';

const UUID_RE = /^[a-f0-9-]+$/i;

// POST — requireApiKey (FDM reports back discovered locations)
//
// FDM sends a BARE ARRAY body — [{ project_id, provider, account_email,
// account_label, path, item_id, matched_on }, ...] — and also passes
// ?project_id=<uuid> so the "found nothing" case (empty array, no items to
// read an id from) is still attributable. A { project_id, locations: [...] }
// wrapper is accepted too for back-compat.
async function handlePost(req, res) {
  try {
    const body = req.body;
    const locations = Array.isArray(body)
      ? body
      : Array.isArray(body?.locations)
        ? body.locations
        : null;

    if (!locations) {
      return res.status(400).json({ error: 'Body must be an array of locations' });
    }

    // project_id: query param is authoritative (handles the empty array);
    // fall back to a wrapper field, then the first item.
    const projectId =
      (typeof req.query.project_id === 'string' && req.query.project_id) ||
      (body && typeof body.project_id === 'string' && body.project_id) ||
      (locations[0] && typeof locations[0].project_id === 'string' && locations[0].project_id) ||
      null;

    if (!projectId || !UUID_RE.test(projectId)) {
      return res.status(400).json({ error: 'Invalid or missing project_id' });
    }

    const machineName =
      (typeof req.query.machine === 'string' && req.query.machine) ||
      (body && typeof body.machine_name === 'string' && body.machine_name) ||
      null;
    const safeMachine = machineName ? sanitizeString(machineName) : null;

    // REPLACE semantics: delete all existing rows for this project first.
    await supabaseFetch(`project_locations?project_id=eq.${projectId}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });

    if (locations.length === 0) {
      // Empty array = searched, found nothing. The delete is the write.
      return res.status(200).json({ ok: true, count: 0 });
    }

    const rows = locations.map(loc => ({
      project_id:    projectId,
      provider:      sanitizeString(loc.provider || ''),
      account_email: loc.account_email ? sanitizeString(loc.account_email) : null,
      account_label: loc.account_label ? sanitizeString(loc.account_label) : null,
      path:          sanitizeString(loc.path || '', 2048),
      item_id:       loc.item_id    ? sanitizeString(loc.item_id, 512) : null,
      file_count:    Number.isFinite(Number(loc.file_count)) ? Math.floor(Number(loc.file_count)) : null,
      total_bytes:   Number.isFinite(Number(loc.total_bytes)) ? Math.floor(Number(loc.total_bytes)) : null,
      matched_on:    loc.matched_on ? sanitizeString(loc.matched_on) : null,
      machine_name:  safeMachine,
    }));

    await supabasePost('project_locations', rows);

    return res.status(200).json({ ok: true, count: rows.length });
  } catch (err) {
    console.error('project-locations POST error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET — requireAuthOrApiKey (dashboard or FDM can read)
async function handleGet(req, res) {
  try {
    const { project_id } = req.query;

    if (project_id) {
      if (typeof project_id !== 'string' || !UUID_RE.test(project_id)) {
        return res.status(400).json({ error: 'Invalid project_id' });
      }
      const rows = await supabaseFetch(
        `project_locations?project_id=eq.${project_id}&order=found_at.desc`
      );
      return res.status(200).json(rows || []);
    }

    // No project_id — return all (capped)
    const rows = await supabaseFetch(
      'project_locations?order=found_at.desc&limit=200'
    );
    return res.status(200).json(rows || []);
  } catch (err) {
    console.error('project-locations GET error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    return requireApiKey(handlePost)(req, res);
  }
  if (req.method === 'GET') {
    return requireAuthOrApiKey(handleGet)(req, res);
  }
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}
