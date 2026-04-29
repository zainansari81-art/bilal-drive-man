// /api/download-progress-live — live download progress endpoint (v3.53.0).
//
// PURPOSE: complement /api/download-progress (the existing endpoint that
// updates download_projects roughly per-file) with a high-cadence
// (~1.5s) channel for per-file detail + current/avg speed. Reads/writes
// a separate table, download_progress_live, so a misbehaving live emitter
// can never corrupt the canonical download_projects row.
//
// AUTH:
//   POST: scanner — requires X-API-Key (same shared secret as
//         /api/download-progress).
//   GET:  dashboard browser OR scanner — accepts session cookie OR
//         X-API-Key (requireAuthOrApiKey), since the dashboard polls
//         this endpoint every ~1.5s while a download is active.
//
// SCHEMA: see supabase-migration-download-progress-live.sql. PK is
// project_id; we upsert on conflict so the table only ever holds one
// live row per project.
//
// SAFETY: completely additive. Existing /api/download-progress is
// untouched. If LIVE_PROGRESS_ENABLED on the scanner is false this
// endpoint simply receives no traffic and the table stays empty.

import { supabaseFetch, supabasePost, supabasePatch } from '../../lib/supabase';
import { requireAuthOrApiKey, sanitizeString } from '../../lib/auth';

// Whitelisted phase values. Mirror /api/download-progress's allowedPhases
// plus the terminal 'complete' value the scanner emits after the final
// post (used by the UI to freeze the card in "Done — averaged X" mode).
const ALLOWED_PHASES = [
  'pinning', 'syncing', 'copying', 'gdrive_staging',
  'wetransfer_staging', 'complete', '',
];
const ALLOWED_SOURCES = ['gdrive', 'dropbox', 'wetransfer', ''];

// Coerce a value to a non-negative BIGINT-safe integer or return null.
// Anything that isn't a finite non-negative number becomes null so we
// never write garbage into the DB (PostgREST would reject it anyway, but
// failing fast here gives the scanner a 400 instead of a 500).
function nonNegInt(val) {
  if (val === undefined || val === null) return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function sanitizeSource(src) {
  if (typeof src !== 'string') return null;
  const v = src.trim().toLowerCase();
  return ALLOWED_SOURCES.includes(v) ? (v || null) : null;
}

function sanitizePhase(phase) {
  if (typeof phase !== 'string') return null;
  const v = phase.trim();
  if (!ALLOWED_PHASES.includes(v)) return null;
  return v === '' ? null : v;
}

export default requireAuthOrApiKey(async function handler(req, res) {
  if (req.method === 'GET') {
    // Dashboard polling. project_id required — this endpoint never
    // returns a list, only one row at a time.
    const { project_id } = req.query;
    if (!project_id) {
      return res.status(400).json({ error: 'Missing required query param: project_id' });
    }
    try {
      const rows = await supabaseFetch(
        `download_progress_live?project_id=eq.${encodeURIComponent(project_id)}&select=*`
      );
      // 200 + null when no row exists yet — UI hides the card in that
      // case rather than throwing. 404 would force every consumer to
      // catch & ignore, which is pointless boilerplate.
      return res.status(200).json(rows?.[0] || null);
    } catch (err) {
      console.error('download-progress-live GET error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // POST: scanner upsert. Anything we don't recognize is silently
  // dropped (forward-compat with newer scanner builds).
  try {
    const {
      project_id,
      current_file_name,
      current_file_index,
      total_files,
      current_file_bytes,
      current_file_size,
      cumulative_bytes,
      total_bytes,
      instant_speed_bps,
      rolling_avg_bps,
      true_avg_bps,
      phase,
      source,
      // Scanner sends 'completed' (boolean-ish) on the final post so we
      // can stamp completed_at server-side rather than trusting the
      // scanner's clock.
      completed,
    } = req.body || {};

    if (!project_id) {
      return res.status(400).json({ error: 'Missing required field: project_id' });
    }

    // Build a minimal upsert body — only include fields the scanner
    // actually sent so partial updates (e.g. a Dropbox-only emit that
    // doesn't know per-file detail) don't clobber columns we do have.
    const body = {
      project_id,
      sampled_at: new Date().toISOString(),
    };

    if (typeof current_file_name === 'string') {
      body.current_file_name = sanitizeString(current_file_name, 500);
    }
    const idx = nonNegInt(current_file_index);
    if (idx !== null) body.current_file_index = idx;
    const tot = nonNegInt(total_files);
    if (tot !== null) body.total_files = tot;
    const cfb = nonNegInt(current_file_bytes);
    if (cfb !== null) body.current_file_bytes = cfb;
    const cfs = nonNegInt(current_file_size);
    if (cfs !== null) body.current_file_size = cfs;
    const cb = nonNegInt(cumulative_bytes);
    if (cb !== null) body.cumulative_bytes = cb;
    const tb = nonNegInt(total_bytes);
    if (tb !== null) body.total_bytes = tb;
    const isb = nonNegInt(instant_speed_bps);
    if (isb !== null) body.instant_speed_bps = isb;
    const rab = nonNegInt(rolling_avg_bps);
    if (rab !== null) body.rolling_avg_bps = rab;
    const tab = nonNegInt(true_avg_bps);
    if (tab !== null) body.true_avg_bps = tab;

    const phaseClean = sanitizePhase(phase);
    if (phaseClean !== null || phase === '') {
      body.phase = phaseClean;
    }
    const srcClean = sanitizeSource(source);
    if (srcClean !== null) body.source = srcClean;

    if (completed === true || completed === 'true' || phase === 'complete') {
      body.completed_at = new Date().toISOString();
    }

    // Upsert: PostgREST does merge on PK conflict when the body
    // includes the PK and the request uses on_conflict + the
    // 'resolution=merge-duplicates' Prefer header that supabasePost
    // already sets.
    await supabasePost('download_progress_live', body, 'project_id');

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('download-progress-live POST error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
