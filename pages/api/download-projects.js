import { supabaseFetch, supabasePost, supabasePatch } from '../../lib/supabase';
import { requireAuth, sanitizeString } from '../../lib/auth';

function detectLinkType(url) {
  if (!url) return 'unknown';
  if (url.includes('dropbox.com')) return 'dropbox';
  if (url.includes('drive.google.com')) return 'google_drive';
  return 'unknown';
}

export default requireAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const projects = await supabaseFetch('download_projects?order=created_at.desc');
      return res.status(200).json(projects || []);
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (!action) {
        return res.status(400).json({ error: 'Missing action field' });
      }

      if (action === 'create') {
        const { client_name, couple_name, download_link } = req.body;
        if (!client_name || !couple_name || !download_link) {
          return res.status(400).json({ error: 'Missing required fields: client_name, couple_name, download_link' });
        }

        const result = await supabasePost('download_projects', {
          client_name: sanitizeString(client_name),
          couple_name: sanitizeString(couple_name),
          download_link: sanitizeString(download_link, 2048),
          link_type: detectLinkType(download_link),
        });
        return res.status(201).json(result);
      }

      if (action === 'add_to_cloud') {
        const { id, assigned_machine } = req.body;
        if (!id) {
          return res.status(400).json({ error: 'Missing project id' });
        }

        const updated = await supabasePatch(`download_projects?id=eq.${id}`, {
          cloud_status: 'connected',
        });

        if (assigned_machine) {
          await supabasePost('download_commands', {
            machine_name: sanitizeString(assigned_machine),
            command: 'add_to_cloud',
            project_id: id,
          });
        }

        return res.status(200).json(updated);
      }

      if (action === 'queue') {
        const { id, assigned_machine } = req.body;
        if (!id) {
          return res.status(400).json({ error: 'Missing project id' });
        }

        // Get max queue_position
        const existing = await supabaseFetch(
          'download_projects?download_status=eq.queued&order=queue_position.desc&limit=1'
        );
        const maxPos = existing && existing.length > 0 ? (existing[0].queue_position || 0) : 0;

        const updateBody = {
          download_status: 'queued',
          queue_position: maxPos + 1,
        };
        if (assigned_machine) {
          updateBody.assigned_machine = sanitizeString(assigned_machine);
        }

        const updated = await supabasePatch(`download_projects?id=eq.${id}`, updateBody);
        return res.status(200).json(updated);
      }

      if (action === 'download_now') {
        const { id } = req.body;
        if (!id) {
          return res.status(400).json({ error: 'Missing project id' });
        }

        const updated = await supabasePatch(`download_projects?id=eq.${id}`, {
          download_status: 'downloading',
        });

        // Get the project to find assigned machine
        const projects = await supabaseFetch(`download_projects?id=eq.${id}`);
        const project = projects && projects[0];
        if (project && project.assigned_machine) {
          await supabasePost('download_commands', {
            machine_name: project.assigned_machine,
            command: 'start_download',
            project_id: id,
          });
        }

        return res.status(200).json(updated);
      }

      if (action === 'cancel') {
        const { id } = req.body;
        if (!id) {
          return res.status(400).json({ error: 'Missing project id' });
        }

        const updated = await supabasePatch(`download_projects?id=eq.${id}`, {
          download_status: 'idle',
        });

        // Get the project to find assigned machine
        const projects = await supabaseFetch(`download_projects?id=eq.${id}`);
        const project = projects && projects[0];
        if (project && project.assigned_machine) {
          await supabasePost('download_commands', {
            machine_name: project.assigned_machine,
            command: 'cancel_download',
            project_id: id,
          });
        }

        return res.status(200).json(updated);
      }

      if (action === 'remove') {
        const { id } = req.body;
        if (!id) {
          return res.status(400).json({ error: 'Missing project id' });
        }

        await supabaseFetch(`download_projects?id=eq.${id}`, {
          method: 'DELETE',
        });
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    if (req.method === 'PATCH') {
      const { id, ...fields } = req.body;
      if (!id) {
        return res.status(400).json({ error: 'Missing project id' });
      }

      // Sanitize string fields
      const sanitized = {};
      for (const [key, value] of Object.entries(fields)) {
        sanitized[key] = typeof value === 'string' ? sanitizeString(value) : value;
      }

      const updated = await supabasePatch(`download_projects?id=eq.${id}`, sanitized);
      return res.status(200).json(updated);
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('Download Projects API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
