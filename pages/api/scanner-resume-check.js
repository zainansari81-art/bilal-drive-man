import { supabaseFetch } from '../../lib/supabase';
import { requireApiKey } from '../../lib/auth';

/**
 * Scanner-only endpoint used on boot to find downloads that were in-flight
 * (downloading / copying) but have no pending command — those were killed by
 * a scanner crash or Windows reboot and need to be re-enqueued.
 *
 * GET /api/scanner-resume-check?machine=HOSTNAME
 * Returns:
 *   { projects: [ { id, couple_name, client_name, cloud_folder_path,
 *                   link_type, target_drive, download_status } ],
 *     pending_project_ids: [string, ...] }
 *
 * The scanner filters out anything in `pending_project_ids` before sending
 * a fresh start_download command.
 */
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

    const projects = await supabaseFetch(
      `download_projects?assigned_machine=eq.${m}` +
        `&download_status=in.(downloading,copying)` +
        `&select=id,couple_name,client_name,download_status,cloud_folder_path,link_type,target_drive`
    );

    const cmds = await supabaseFetch(
      `download_commands?machine_name=eq.${m}` +
        `&status=in.(pending,running)` +
        `&select=project_id,command`
    );

    const pendingProjectIds = (cmds || [])
      .map((c) => c.project_id)
      .filter(Boolean);

    return res.status(200).json({
      projects: projects || [],
      pending_project_ids: pendingProjectIds,
    });
  } catch (err) {
    console.error('Scanner resume-check API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
