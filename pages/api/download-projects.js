import { supabaseFetch, supabasePost, supabasePatch } from '../../lib/supabase';
import { requireAuth, sanitizeString } from '../../lib/auth';
import { updateNotionProjectStatus } from '../../lib/notion';

/**
 * Fire-and-forget Notion status write. Wraps updateNotionProjectStatus so
 * portal actions don't have to await it and don't fail if Notion write
 * permission is missing.
 */
function syncNotionStatus(pageId, status) {
  if (!pageId) return;
  updateNotionProjectStatus(pageId, status).catch(() => {});
}

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
        if (!id || typeof id !== 'string' || !/^[a-f0-9-]+$/i.test(id)) {
          return res.status(400).json({ error: 'Invalid id' });
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
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) {
          return res.status(400).json({ error: 'Invalid id' });
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

        // Mirror to Notion so the next sync doesn't revert our change.
        const rowsQ = await supabaseFetch(`download_projects?id=eq.${pid}&select=notion_page_id`);
        syncNotionStatus(rowsQ?.[0]?.notion_page_id, 'queued');

        return res.status(200).json(updated);
      }

      if (action === 'download_now') {
        const pid = req.body.projectId || req.body.id;
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) {
          return res.status(400).json({ error: 'Invalid id' });
        }

        // Inline overrides from the Download wizard (when user picks machine/
        // drive at click time). target_drive is optional — if blank, the
        // scanner downloads to the PC's cloud folder and stops there so the
        // user can decide later where to copy.
        const overrideMachine = req.body.assigned_machine
          ? sanitizeString(req.body.assigned_machine)
          : null;
        const overrideDrive =
          typeof req.body.target_drive === 'string'
            ? sanitizeString(req.body.target_drive)
            : null;

        const projects = await supabaseFetch(`download_projects?id=eq.${pid}`);
        const project = projects && projects[0];
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const machineToUse = overrideMachine || project.assigned_machine;
        if (!machineToUse) {
          return res.status(400).json({
            error: 'MACHINE_REQUIRED',
            message: 'Pick which PC should handle this download.',
          });
        }

        // target_drive defaults to whatever's saved. Wizard can pass '' to
        // mean "skip drive copy, just sync to this PC".
        const driveToUse =
          overrideDrive !== null ? overrideDrive : project.target_drive || '';

        // Persist overrides + flip status + clear queue slot
        const updatePayload = {
          download_status: 'downloading',
          queue_position: null,
          assigned_machine: machineToUse,
        };
        if (overrideDrive !== null) updatePayload.target_drive = driveToUse;

        const updated = await supabasePatch(
          `download_projects?id=eq.${pid}`,
          updatePayload
        );

        // Mirror status to Notion so the next Notion → Supabase sync doesn't
        // revert us back to "Not Downloaded".
        syncNotionStatus(project.notion_page_id, 'downloading');

        // For Dropbox / Google Drive shared links, the scanner must first add
        // the link to the user's cloud account so the desktop app syncs it.
        // For direct links (wetransfer etc) we skip this and go straight to
        // start_download.
        let needsCloudAdd =
          project.download_link &&
          (project.link_type === 'dropbox' || project.link_type === 'google_drive');

        // Duplicate-link dedupe: if another project sharing this download_link
        // is already active on the same machine, the cloud mount is either
        // already done or in flight — skip add_to_cloud to avoid duplicate
        // mount attempts (which can fail and fail loudly).
        if (needsCloudAdd) {
          try {
            const linkParam = encodeURIComponent(project.download_link);
            const dupes = await supabaseFetch(
              `download_projects?download_link=eq.${linkParam}&id=neq.${pid}` +
                `&assigned_machine=eq.${encodeURIComponent(machineToUse)}`
            );
            const hasActiveDupe = (dupes || []).some((d) =>
              ['downloading', 'copying'].includes(d.download_status)
            );
            if (hasActiveDupe) {
              needsCloudAdd = false;
              console.log(
                `download_now ${pid}: skipping add_to_cloud — link already syncing on ${machineToUse}`
              );
            }
          } catch (e) {
            // If dedupe lookup fails, fall back to the safe default (send it).
            console.error('Duplicate-link dedupe lookup failed:', e.message);
          }
        }

        if (needsCloudAdd) {
          await supabasePost('download_commands', {
            machine_name: machineToUse,
            command: 'add_to_cloud',
            project_id: pid,
            payload: {
              download_link: project.download_link,
              link_type: project.link_type,
              couple_name: project.couple_name || '',
            },
            status: 'pending',
          });
        }

        // start_download monitors the cloud folder, pins files offline, and —
        // when all files are local — auto-chains into copy_to_drive IF a
        // target_drive is set. If driveToUse is empty the scanner stops after
        // the sync, leaving the data in the PC's cloud folder so the user can
        // run "Copy to Drive" later.
        await supabasePost('download_commands', {
          machine_name: machineToUse,
          command: 'start_download',
          project_id: pid,
          payload: {
            cloud_folder_path: project.cloud_folder_path || '',
            link_type: project.link_type || '',
            couple_name: project.couple_name || '',
            client_name: project.client_name || 'Unknown',
            target_drive: driveToUse,
          },
          status: 'pending',
        });

        return res.status(200).json(updated);
      }

      if (action === 'pause') {
        const pid = req.body.projectId || req.body.id;
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) return res.status(400).json({ error: 'Invalid id' });

        const updated = await supabasePatch(`download_projects?id=eq.${pid}`, {
          download_status: 'paused',
        });

        // Send pause command to scanner
        const projects = await supabaseFetch(`download_projects?id=eq.${pid}`);
        const project = projects && projects[0];
        if (project && project.assigned_machine) {
          await supabasePost('download_commands', {
            machine_name: project.assigned_machine,
            command: 'cancel_download',
            project_id: pid,
            status: 'pending',
          });
        }
        // 'paused' maps to 'Downloading' in Notion (no native Paused state).
        syncNotionStatus(project?.notion_page_id, 'paused');
        return res.status(200).json(updated);
      }

      if (action === 'resume') {
        const pid = req.body.projectId || req.body.id;
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) return res.status(400).json({ error: 'Invalid id' });

        const updated = await supabasePatch(`download_projects?id=eq.${pid}`, {
          download_status: 'downloading',
        });

        const projects = await supabaseFetch(`download_projects?id=eq.${pid}`);
        const project = projects && projects[0];
        if (project && project.assigned_machine) {
          await supabasePost('download_commands', {
            machine_name: project.assigned_machine,
            command: 'start_download',
            project_id: pid,
            payload: {
              cloud_folder_path: project.cloud_folder_path || '',
              link_type: project.link_type || '',
              couple_name: project.couple_name || '',
              client_name: project.client_name || 'Unknown',
              target_drive: project.target_drive || '',
            },
            status: 'pending',
          });
        }
        syncNotionStatus(project?.notion_page_id, 'downloading');
        return res.status(200).json(updated);
      }

      if (action === 'cancel') {
        const pid = req.body.projectId || req.body.id;
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) {
          return res.status(400).json({ error: 'Invalid id' });
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
        syncNotionStatus(project?.notion_page_id, 'idle');

        return res.status(200).json(updated);
      }

      if (action === 'remove') {
        const pid = req.body.projectId || req.body.id;
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) {
          return res.status(400).json({ error: 'Invalid id' });
        }

        await supabaseFetch(`download_projects?id=eq.${pid}`, {
          method: 'DELETE',
        });
        return res.status(200).json({ success: true });
      }

      if (action === 'set-target') {
        const { projectId, targetDrive } = req.body;
        const pid = projectId || req.body.id;
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) return res.status(400).json({ error: 'Invalid id' });
        const updated = await supabasePatch(`download_projects?id=eq.${pid}`, {
          target_drive: sanitizeString(targetDrive || ''),
        });
        return res.status(200).json(updated);
      }

      if (action === 'update') {
        const { projectId, fields } = req.body;
        const pid = projectId || req.body.id;
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) return res.status(400).json({ error: 'Invalid id' });
        if (!fields) return res.status(400).json({ error: 'Missing fields' });
        const sanitized = {};
        const allowedFields = ['couple_name', 'client_name', 'project_date', 'size_gb', 'target_drive', 'download_link', 'download_status', 'assigned_machine', 'cloud_folder_path'];
        for (const [key, value] of Object.entries(fields)) {
          if (allowedFields.includes(key)) {
            sanitized[key] = typeof value === 'string' ? sanitizeString(value, 2048) : value;
          }
        }
        if (sanitized.download_link) {
          sanitized.link_type = detectLinkType(sanitized.download_link);
        }
        const updated = await supabasePatch(`download_projects?id=eq.${pid}`, sanitized);

        // If the user changed download_status via the inline dropdown, push
        // the new value up to Notion too.
        if (sanitized.download_status) {
          const rowsU = await supabaseFetch(`download_projects?id=eq.${pid}&select=notion_page_id`);
          syncNotionStatus(rowsU?.[0]?.notion_page_id, sanitized.download_status);
        }

        return res.status(200).json(updated);
      }

      if (action === 'assign_machine') {
        const pid = req.body.projectId || req.body.id;
        const { machine_name } = req.body;
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) return res.status(400).json({ error: 'Invalid id' });

        const updated = await supabasePatch(`download_projects?id=eq.${pid}`, {
          assigned_machine: machine_name ? sanitizeString(machine_name) : null,
        });
        return res.status(200).json(updated);
      }

      if (action === 'copy_to_drive') {
        const pid = req.body.projectId || req.body.id;
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) return res.status(400).json({ error: 'Invalid id' });

        // Get project details
        const projects = await supabaseFetch(`download_projects?id=eq.${pid}`);
        const project = projects && projects[0];
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (!project.assigned_machine) return res.status(400).json({ error: 'No machine assigned' });
        if (!project.target_drive) return res.status(400).json({ error: 'No target drive set' });

        // Update status
        await supabasePatch(`download_projects?id=eq.${pid}`, {
          download_status: 'copying',
        });
        syncNotionStatus(project.notion_page_id, 'copying');

        // Send copy command to the scanner
        await supabasePost('download_commands', {
          machine_name: project.assigned_machine,
          command: 'copy_to_drive',
          project_id: pid,
          payload: {
            source_path: project.cloud_folder_path || '',
            target_drive: project.target_drive,
            client_name: project.client_name || 'Unknown',
            couple_name: project.couple_name || 'Unknown',
            link_type: project.link_type || '',
          },
          status: 'pending',
        });

        return res.status(200).json({ success: true });
      }

      if (action === 'start_cloud_download') {
        const pid = req.body.projectId || req.body.id;
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) return res.status(400).json({ error: 'Invalid id' });

        const projects = await supabaseFetch(`download_projects?id=eq.${pid}`);
        const project = projects && projects[0];
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (!project.assigned_machine) return res.status(400).json({ error: 'No machine assigned' });

        // Update status to downloading
        await supabasePatch(`download_projects?id=eq.${pid}`, {
          download_status: 'downloading',
          queue_position: null,
        });
        syncNotionStatus(project.notion_page_id, 'downloading');

        // Step 1: Send add_to_cloud command (adds shared link to user's cloud account)
        if (project.download_link && (project.link_type === 'dropbox' || project.link_type === 'google_drive')) {
          await supabasePost('download_commands', {
            machine_name: project.assigned_machine,
            command: 'add_to_cloud',
            project_id: pid,
            payload: {
              download_link: project.download_link,
              link_type: project.link_type,
              couple_name: project.couple_name || '',
            },
            status: 'pending',
          });
        }

        // Step 2: Send start_download command (finds folder, pins offline, monitors, copies)
        await supabasePost('download_commands', {
          machine_name: project.assigned_machine,
          command: 'start_download',
          project_id: pid,
          payload: {
            cloud_folder_path: project.cloud_folder_path || '',
            link_type: project.link_type || '',
            couple_name: project.couple_name || '',
            client_name: project.client_name || 'Unknown',
            target_drive: project.target_drive || '',
          },
          status: 'pending',
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

      if (!id || typeof id !== 'string' || !/^[a-f0-9-]+$/i.test(id)) {
        return res.status(400).json({ error: 'Invalid id' });
      }

      // Whitelist allowed fields
      const allowedPatchFields = ['download_status', 'download_link', 'link_type', 'target_drive', 'assigned_machine', 'size_gb', 'error_message', 'progress_percent'];
      const sanitized = {};
      for (const [key, value] of Object.entries(fields)) {
        if (allowedPatchFields.includes(key)) {
          sanitized[key] = typeof value === 'string' ? sanitizeString(value) : value;
        }
      }

      const updated = await supabasePatch(`download_projects?id=eq.${id}`, sanitized);

      // Status-write paths need to mirror up to Notion.
      if (sanitized.download_status) {
        const rowsP = await supabaseFetch(`download_projects?id=eq.${id}&select=notion_page_id`);
        syncNotionStatus(rowsP?.[0]?.notion_page_id, sanitized.download_status);
      }

      return res.status(200).json(updated);
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('Download Projects API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
