import { supabaseFetch, supabasePost, supabasePatch } from '../../lib/supabase';
import { requireApiKey, sanitizeString } from '../../lib/auth';
import { updateNotionProjectStatus } from '../../lib/notion';

export default requireApiKey(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { project_id, progress_bytes, status, error_message, phase } = req.body;
    if (!project_id) {
      return res.status(400).json({ error: 'Missing required field: project_id' });
    }

    const updateBody = {};
    if (progress_bytes !== undefined) {
      updateBody.progress_bytes = progress_bytes;
    }
    if (status) {
      updateBody.download_status = sanitizeString(status);
    }
    if (error_message) {
      updateBody.error_message = sanitizeString(error_message, 1024);
    }
    // Sub-phase within downloading/copying. Scanner sends 'pinning' | 'syncing'
    // | 'copying' | '' (to clear). Anything else is silently dropped.
    if (phase !== undefined) {
      const allowedPhases = ['pinning', 'syncing', 'copying', ''];
      if (allowedPhases.includes(phase)) {
        updateBody.download_phase = phase === '' ? null : phase;
      }
    }

    // If completed, set completed_at timestamp and clear phase
    if (status === 'completed') {
      updateBody.completed_at = new Date().toISOString();
      updateBody.download_phase = null;
    }

    // Fetch current state BEFORE the patch so we can detect a real status
    // transition and avoid spamming Notion on every progress-bytes update.
    let priorStatus = null;
    let notionId = null;
    if (status) {
      try {
        const rows = await supabaseFetch(
          `download_projects?id=eq.${project_id}&select=notion_page_id,download_status`
        );
        priorStatus = rows?.[0]?.download_status || null;
        notionId = rows?.[0]?.notion_page_id || null;
      } catch (e) {
        // Non-fatal — Notion write just gets skipped.
      }
    }

    const updated = await supabasePatch(`download_projects?id=eq.${project_id}`, updateBody);

    // Push scanner-reported status up to Notion — but only when the status
    // actually changed. The scanner hits this endpoint every 30s during sync
    // and once per file during copy; we don't want to hammer Notion's API.
    if (status && notionId && status !== priorStatus) {
      updateNotionProjectStatus(notionId, status).catch(() => {});
    }

    // If completed, check for next queued project on the same machine
    if (status === 'completed') {
      const projects = await supabaseFetch(`download_projects?id=eq.${project_id}`);
      const completedProject = projects && projects[0];

      if (completedProject && completedProject.assigned_machine) {
        const machine = completedProject.assigned_machine;

        // Find next queued project for this machine
        const queued = await supabaseFetch(
          `download_projects?assigned_machine=eq.${encodeURIComponent(machine)}&download_status=eq.queued&order=queue_position.asc&limit=1`
        );

        if (queued && queued.length > 0) {
          const nextProject = queued[0];

          // Update next project to downloading
          await supabasePatch(`download_projects?id=eq.${nextProject.id}`, {
            download_status: 'downloading',
          });
          if (nextProject.notion_page_id) {
            updateNotionProjectStatus(nextProject.notion_page_id, 'downloading').catch(() => {});
          }

          // Create start_download command for the machine
          await supabasePost('download_commands', {
            machine_name: machine,
            command: 'start_download',
            project_id: nextProject.id,
            status: 'pending',
          });
        }
      }
    }

    return res.status(200).json(updated);
  } catch (err) {
    console.error('Download Progress API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
