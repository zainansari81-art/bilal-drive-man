import { supabaseFetch, supabasePost, supabasePatch } from '../../lib/supabase';
import { requireApiKey, sanitizeString } from '../../lib/auth';
import { updateNotionProjectStatus } from '../../lib/notion';

export default requireApiKey(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { project_id, progress_bytes, status, error_message, phase, cloud_folder_path } = req.body;
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
    // Scanner records the resolved cloud folder name here right after
    // add_to_cloud succeeds. start_download then reads cloud_folder_path from
    // the project row rather than having to re-derive it via the fragile
    // couple_name substring match in find_cloud_folder.
    if (typeof cloud_folder_path === 'string' && cloud_folder_path.length > 0) {
      updateBody.cloud_folder_path = sanitizeString(cloud_folder_path, 500);
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

    // Race-guard: when scanner tells us the resolved cloud_folder_path in the
    // same call that completes add_to_cloud, the start_download command that
    // was enqueued alongside already has a stale (empty) cloud_folder_path in
    // its payload JSON. Backfill it on any still-pending or acked
    // start_download for this project so the scanner reads the correct path
    // when it picks the command up.
    if (updateBody.cloud_folder_path) {
      try {
        const pending = await supabaseFetch(
          `download_commands?project_id=eq.${project_id}` +
            `&command=eq.start_download` +
            `&status=in.(pending,acked)` +
            `&select=id,payload`
        );
        for (const cmd of pending || []) {
          const mergedPayload = { ...(cmd.payload || {}), cloud_folder_path: updateBody.cloud_folder_path };
          try {
            await supabasePatch(`download_commands?id=eq.${cmd.id}`, { payload: mergedPayload });
          } catch (patchErr) {
            console.error(`Failed to backfill cloud_folder_path on command ${cmd.id}:`, patchErr.message);
          }
        }
      } catch (fetchErr) {
        // Non-fatal — scanner can still fall back to find_cloud_folder on couple_name.
        console.error('Backfill of start_download payloads failed:', fetchErr.message);
      }
    }

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
