import { supabaseFetch, supabasePatch } from '../../lib/supabase';
import { requireApiKey } from '../../lib/auth';

/**
 * Scanner-only endpoint used on boot to find downloads that were in-flight
 * (downloading / copying) but have no pending command — those were killed by
 * a scanner crash or Windows reboot and need to be re-enqueued.
 *
 * Enforces a server-side cap on resume attempts (Gap 4): each call to this
 * endpoint increments `resume_attempts` on every returned project. Once a
 * project hits MAX_RESUME_ATTEMPTS, it is transitioned to `failed` with
 * `error_message = 'Exceeded resume attempts'` and excluded from the
 * response, so the scanner stops re-queueing broken projects indefinitely.
 *
 * GET /api/scanner-resume-check?machine=HOSTNAME
 * Returns:
 *   { projects: [ { id, couple_name, client_name, cloud_folder_path,
 *                   link_type, target_drive, download_status, resume_attempts } ],
 *     pending_project_ids: [string, ...],
 *     exhausted: [ { id, couple_name } ]  // projects we just marked failed
 *   }
 *
 * The scanner filters out anything in `pending_project_ids` before sending
 * a fresh start_download command.
 */

const MAX_RESUME_ATTEMPTS = 3;

export default requireApiKey(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { machine } = req.query;
    if (!machine) {
      return res.status(400).json({ error: 'Missing required query parameter: machine' });
    }

    const m = encodeURIComponent(machine);

    const candidates = await supabaseFetch(
      `download_projects?assigned_machine=eq.${m}` +
        `&download_status=in.(downloading,copying)` +
        `&select=id,couple_name,client_name,download_status,cloud_folder_path,link_type,target_drive,resume_attempts`
    );

    const cmds = await supabaseFetch(
      `download_commands?machine_name=eq.${m}` +
        `&status=in.(pending,running)` +
        `&select=project_id,command`
    );

    const pendingProjectIds = (cmds || [])
      .map((c) => c.project_id)
      .filter(Boolean);

    const pendingSet = new Set(pendingProjectIds);
    const nowIso = new Date().toISOString();

    const projects = [];
    const exhausted = [];

    for (const p of candidates || []) {
      // Skip projects that already have a pending/running command — the scanner
      // will pick those up through its normal command queue polling. We only
      // meter the truly-orphaned ones.
      if (pendingSet.has(p.id)) continue;

      const attempts = typeof p.resume_attempts === 'number' ? p.resume_attempts : 0;

      if (attempts >= MAX_RESUME_ATTEMPTS) {
        // Cap hit — transition to failed and do NOT return to scanner.
        try {
          await supabasePatch(`download_projects?id=eq.${p.id}`, {
            download_status: 'failed',
            error_message: 'Exceeded resume attempts',
            last_resume_at: nowIso,
          });
          exhausted.push({ id: p.id, couple_name: p.couple_name });
        } catch (patchErr) {
          // If the PATCH fails we still exclude the project from the response
          // so the scanner doesn't keep spinning on it this boot.
          console.error('Failed to mark exhausted project:', patchErr.message);
          exhausted.push({ id: p.id, couple_name: p.couple_name });
        }
        continue;
      }

      // Still within the allowed envelope — increment the counter and include.
      try {
        await supabasePatch(`download_projects?id=eq.${p.id}`, {
          resume_attempts: attempts + 1,
          last_resume_at: nowIso,
        });
      } catch (patchErr) {
        console.error('Failed to increment resume_attempts:', patchErr.message);
        // Even if the counter update fails, return the project so the scanner
        // can still try to resume it — next boot's cap check will catch it.
      }

      projects.push({
        ...p,
        resume_attempts: attempts + 1,
      });
    }

    return res.status(200).json({
      projects,
      pending_project_ids: pendingProjectIds,
      exhausted,
    });
  } catch (err) {
    console.error('Scanner resume-check API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
