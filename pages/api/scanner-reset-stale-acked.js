import { supabasePatch } from '../../lib/supabase';
import { requireApiKey, sanitizeString } from '../../lib/auth';

/**
 * Scanner-only endpoint used on boot (v3.45.0 gap-fix #2).
 *
 * Fixes the "scanner killed mid-exec → command stuck `acked` forever" class of
 * bugs. On startup, the scanner calls this endpoint to flip any of *its own*
 * acked commands that have been orphaned (scanner died between the ack patch
 * and the handler finishing) back to pending, so the current boot can pick
 * them up via the normal poll cycle.
 *
 * 60s safety threshold (Mac-Claude's refinement): commands acked in the last
 * 60s are left alone — they may be legitimate sibling-thread in-flight work
 * that just hadn't completed yet. Only commands acked >= threshold_seconds
 * ago are reset. Belt-and-suspenders against the "two scanners on same
 * machine_name" edge case (scenario G).
 *
 * POST /api/scanner-reset-stale-acked
 * Auth: scanner (X-API-Key)
 * Body: { machine_name: string, threshold_seconds?: number = 60 }
 * Returns: { reset: number, ids: [uuid] }
 *
 * Uses server-clock (Vercel) for the cutoff calculation, which dodges scanner
 * clock-skew (scenario H) for free. PostgREST PATCH with filter is atomic on
 * the Supabase side, so there is no SELECT-then-UPDATE race.
 */

export default requireApiKey(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { machine_name, threshold_seconds } = req.body || {};

    if (!machine_name || typeof machine_name !== 'string') {
      return res.status(400).json({ error: 'Missing required field: machine_name' });
    }

    const sanitizedMachine = sanitizeString(machine_name, 200);
    if (!sanitizedMachine) {
      return res.status(400).json({ error: 'Invalid machine_name' });
    }

    // Clamp threshold to [10, 3600] seconds — below 10s is too tight
    // (sibling threads genuinely take that long), above 1h is pointless.
    let threshold = 60;
    if (typeof threshold_seconds === 'number' && Number.isFinite(threshold_seconds)) {
      threshold = Math.max(10, Math.min(3600, Math.floor(threshold_seconds)));
    }

    const cutoffIso = new Date(Date.now() - threshold * 1000).toISOString();

    // Atomic PATCH with filter: Supabase updates every row matching the
    // (machine_name, status='acked', created_at<cutoff) tuple in one call and
    // returns the affected rows via `Prefer: return=representation`.
    const filter =
      `download_commands?` +
      `machine_name=eq.${encodeURIComponent(sanitizedMachine)}` +
      `&status=eq.acked` +
      `&created_at=lt.${encodeURIComponent(cutoffIso)}`;

    const updated = await supabasePatch(filter, { status: 'pending' });
    const rows = Array.isArray(updated) ? updated : [];

    return res.status(200).json({
      reset: rows.length,
      ids: rows.map((r) => r.id).filter(Boolean),
      threshold_seconds: threshold,
      cutoff: cutoffIso,
    });
  } catch (err) {
    console.error('Scanner reset-stale-acked API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
