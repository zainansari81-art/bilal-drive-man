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
        const { id, projectId, assigned_machine, position } = req.body;
        const pid = projectId || id;
        if (!pid) {
          return res.status(400).json({ error: 'Missing project id' });
        }

        let queuePos;
        if (position) {
          // Explicit position (Q1, Q2, Q3...)
          queuePos = parseInt(position);
        } else {
          // Auto-assign next position
          const existing = await supabaseFetch(
            'download_projects?download_status=eq.queued&order=queue_position.desc&limit=1'
          );
          const maxPos = existing && existing.length > 0 ? (existing[0].queue_position || 0) : 0;
          queuePos = maxPos + 1;
        }

        const updateBody = {
          download_status: 'queued',
          queue_position: queuePos,
        };
        if (assigned_machine) {
          updateBody.assigned_machine = sanitizeString(assigned_machine);
        }

        const updated = await supabasePatch(`download_projects?id=eq.${pid}`, updateBody);
        return res.status(200).json(updated);
      }

      if (action === 'download_now') {
        const pid = req.body.projectId || req.body.id;
        if (!pid) {
          return res.status(400).json({ error: 'Missing project id' });
        }

        const updated = await supabasePatch(`download_projects?id=eq.${pid}`, {
          download_status: 'downloading',
          queue_position: null,
        });

        // Get the project to find assigned machine
        const projects = await supabaseFetch(`download_projects?id=eq.${pid}`);
        const project = projects && projects[0];
        if (project && project.assigned_machine) {
          await supabasePost('download_commands', {
            machine_name: project.assigned_machine,
            command: 'start_download',
            project_id: pid,
          });
        }

        return res.status(200).json(updated);
      }

      if (action === 'cancel') {
        const pid = req.body.projectId || req.body.id;
        if (!pid) {
          return res.status(400).json({ error: 'Missing project id' });
        }

        const updated = await supabasePatch(`download_projects?id=eq.${pid}`, {
          download_status: 'idle',
          queue_position: null,
        });

        // Get the project to find assigned machine
        const projects = await supabaseFetch(`download_projects?id=eq.${pid}`);
        const project = projects && projects[0];
        if (project && project.assigned_machine) {
          await supabasePost('download_commands', {
            machine_name: project.assigned_machine,
            command: 'cancel_download',
            project_id: pid,
          });
        }

        return res.status(200).json(updated);
      }

      if (action === 'remove') {
        const pid = req.body.projectId || req.body.id;
        if (!pid) {
          return res.status(400).json({ error: 'Missing project id' });
        }

        await supabaseFetch(`download_projects?id=eq.${pid}`, {
          method: 'DELETE',
        });
        return res.status(200).json({ success: true });
      }

      if (action === 'set-target') {
        const { projectId, targetDrive } = req.body;
        const pid = projectId || req.body.id;
        if (!pid) return res.status(400).json({ error: 'Missing project id' });
        const updated = await supabasePatch(`download_projects?id=eq.${pid}`, {
          target_drive: sanitizeString(targetDrive || ''),
        });
        return res.status(200).json(updated);
      }

      if (action === 'update') {
        const { projectId, fields } = req.body;
        const pid = projectId || req.body.id;
        if (!pid || !fields) return res.status(400).json({ error: 'Missing project id or fields' });
        const sanitized = {};
        const allowedFields = ['couple_name', 'client_name', 'project_date', 'size_gb', 'target_drive', 'download_link', 'download_status'];
        for (const [key, value] of Object.entries(fields)) {
          if (allowedFields.includes(key)) {
            sanitized[key] = typeof value === 'string' ? sanitizeString(value, 2048) : value;
          }
        }
        if (sanitized.download_link) {
          sanitized.link_type = detectLinkType(sanitized.download_link);
        }
        const updated = await supabasePatch(`download_projects?id=eq.${pid}`, sanitized);
        return res.status(200).json(updated);
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
