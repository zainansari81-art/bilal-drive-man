import { supabaseFetch, supabasePost, supabasePatch } from '../../lib/supabase';
import { requireAuthOrApiKey, sanitizeString } from '../../lib/auth';
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
  if (url.includes('we.tl') || url.includes('wetransfer.com')) return 'wetransfer';
  return 'unknown';
}

// WeTransfer projects are now supported via the same direct-download pattern
// as Google Drive 3.46.0 (per-file download to staging, then copy_to_drive).
// The scanner's add_to_cloud handler resolves the we.tl/wetransfer.com share
// into a list of files and downloads them one-by-one (no zip — zip fails
// mid-transfer for big sets). isWetransferProject is kept for any place we
// need to dispatch on link_type.
function isWetransferProject(project) {
  if (!project) return false;
  if (project.link_type === 'wetransfer') return true;
  return detectLinkType(project.download_link) === 'wetransfer';
}

export default requireAuthOrApiKey(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Single-project fetch — used by the scanner to re-read a project
      // row (specifically `cloud_folder_path`) when handle_start_download
      // arrives before add_to_cloud's backfill has propagated. v3.50.0
      // bug-fix #2 closes that race.
      if (req.query.id) {
        const id = String(req.query.id);
        if (!/^[a-f0-9-]+$/i.test(id)) {
          return res.status(400).json({ error: 'Invalid id' });
        }
        const rows = await supabaseFetch(`download_projects?id=eq.${id}`);
        return res.status(200).json(rows?.[0] || null);
      }
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

        // Gap 1 — optional cloud account override from the wizard. Null/empty
        // means "use the PC's default cloud path" (today's behavior). A UUID
        // means "route this download to a specific cloud_accounts row".
        // The scanner-side lookup is additive and ships later; until then,
        // scanner ignores the payload field and the ID is just persisted.
        let overrideCloudAccountId = null;
        if (typeof req.body.cloud_account_id === 'string') {
          const raw = req.body.cloud_account_id.trim();
          if (raw === '') {
            overrideCloudAccountId = null;
          } else if (/^[a-f0-9-]{36}$/i.test(raw)) {
            overrideCloudAccountId = raw;
          } else {
            return res.status(400).json({ error: 'Invalid cloud_account_id' });
          }
        }

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

        // The ID that will travel with scanner commands below. If the caller
        // didn't pass one, fall back to whatever the project already had.
        const cloudAccountIdToUse =
          overrideCloudAccountId !== null
            ? overrideCloudAccountId
            : project.cloud_account_id || null;

        // v3.52.0: queue-when-busy. If another project for this machine is
        // already actively downloading or copying, set this one to 'queued'
        // with a queue_position so the user sees a clear "Queued" badge.
        // The download-progress.js completion handler picks up the next
        // 'queued' project for the same machine when the current one
        // finishes — so we DON'T emit the start_download / add_to_cloud
        // commands here when queuing; they'll be emitted on dequeue.
        const busyRows = await supabaseFetch(
          `download_projects?assigned_machine=eq.${encodeURIComponent(machineToUse)}` +
            `&download_status=in.(downloading,copying)` +
            `&id=neq.${pid}` +
            `&select=id`
        );
        const machineBusy = (busyRows || []).length > 0;

        let queuePositionToUse = null;
        if (machineBusy) {
          // Find max existing queue_position on this machine and add 1.
          const queuedRows = await supabaseFetch(
            `download_projects?assigned_machine=eq.${encodeURIComponent(machineToUse)}` +
              `&download_status=eq.queued` +
              `&select=queue_position&order=queue_position.desc&limit=1`
          );
          const maxPos = queuedRows?.[0]?.queue_position || 0;
          queuePositionToUse = maxPos + 1;
        }

        // Persist overrides + flip status (queued OR downloading)
        const updatePayload = {
          download_status: machineBusy ? 'queued' : 'downloading',
          queue_position: queuePositionToUse,
          assigned_machine: machineToUse,
        };
        if (overrideDrive !== null) updatePayload.target_drive = driveToUse;
        if (overrideCloudAccountId !== null) {
          updatePayload.cloud_account_id = overrideCloudAccountId;
        }

        const updated = await supabasePatch(
          `download_projects?id=eq.${pid}`,
          updatePayload
        );

        // Mirror status to Notion so the next Notion → Supabase sync doesn't
        // revert us back to "Not Downloaded".
        syncNotionStatus(project.notion_page_id, machineBusy ? 'queued' : 'downloading');

        // If queued, stop here — commands will be emitted by the
        // download-progress completion handler when its turn comes.
        if (machineBusy) {
          return res.status(200).json(updated);
        }

        // For Dropbox / Google Drive / WeTransfer, the scanner's add_to_cloud
        // step does the share resolution + (for Dropbox) cloud mount. For
        // GDrive/WeTransfer it lists files and stages them locally (no cloud
        // sync involved). All three need the add_to_cloud command before
        // start_download can run.
        let needsCloudAdd =
          project.download_link &&
          (project.link_type === 'dropbox' ||
            project.link_type === 'google_drive' ||
            project.link_type === 'wetransfer');

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
              cloud_account_id: cloudAccountIdToUse,
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
            cloud_account_id: cloudAccountIdToUse,
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
              cloud_account_id: project.cloud_account_id || null,
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

        // Fetch project before delete so we can stop the scanner mid-flight
        // and sync Notion. Without this, removing a downloading project orphans
        // the scanner thread + leaves Notion's status stale (next notion-sync
        // would re-create the project as not-deleted).
        const projects = await supabaseFetch(`download_projects?id=eq.${pid}`);
        const project = projects && projects[0];

        if (project?.assigned_machine) {
          // Best-effort cancel — scanner's handle_cancel_download will signal
          // its cancel-event, which propagates to staging download loops + the
          // 90s wait-and-poll tick. Failure here shouldn't block the delete.
          try {
            await supabasePost('download_commands', {
              machine_name: project.assigned_machine,
              command: 'cancel_download',
              project_id: pid,
              status: 'pending',
            });
          } catch (e) {
            console.error('Cancel-on-remove failed:', e.message);
          }
        }

        // Notion sync to 'idle' so the next notion-sync doesn't see a stale
        // 'Downloading' state for a now-deleted row and recreate it.
        if (project?.notion_page_id) {
          syncNotionStatus(project.notion_page_id, 'idle');
        }

        await supabaseFetch(`download_projects?id=eq.${pid}`, {
          method: 'DELETE',
        });
        return res.status(200).json({ success: true });
      }

      if (action === 'reset') {
        // Manual "Re-download" — clears completion state on a project so the
        // wizard treats it as fresh. Used when Bilal has deleted the local
        // copy from the external drive and wants to re-pull (e.g. client gave
        // changes after the original download). Auto-reset on couple-folder
        // deletion is the scanner's job (drive scanner detects is_present
        // flip and resets); this endpoint is the manual override for cases
        // where the scanner can't observe the deletion (offline drive,
        // renamed folder, etc.).
        const pid = req.body.projectId || req.body.id;
        if (!pid || typeof pid !== 'string' || !/^[a-f0-9-]+$/i.test(pid)) {
          return res.status(400).json({ error: 'Invalid id' });
        }

        const projects = await supabaseFetch(`download_projects?id=eq.${pid}`);
        const project = projects && projects[0];
        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }

        // Only allow reset from terminal states. Resetting a live download
        // would orphan the scanner thread (use cancel/remove for that).
        const allowedStatuses = ['completed', 'failed'];
        if (!allowedStatuses.includes(project.download_status)) {
          return res.status(400).json({
            error: 'INVALID_STATE',
            message:
              `Cannot reset a project in status='${project.download_status}'. ` +
              `Only completed or failed projects can be reset.`,
          });
        }

        const updated = await supabasePatch(`download_projects?id=eq.${pid}`, {
          download_status: 'idle',
          download_phase: null,
          progress_bytes: 0,
          total_bytes_expected: null,
          cloud_status: 'pending',
          cloud_folder_path: null,
          error_message: null,
          completed_at: null,
        });

        // Notion mirror so next notion-sync doesn't re-stamp 'Done' over our
        // fresh idle state. Best-effort — failure here doesn't block the
        // reset (Notion sync is eventually-consistent and a manual flip is
        // always possible).
        if (project.notion_page_id) {
          syncNotionStatus(project.notion_page_id, 'idle');
        }

        return res.status(200).json(updated);
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
        if (
          project.download_link &&
          (project.link_type === 'dropbox' ||
            project.link_type === 'google_drive' ||
            project.link_type === 'wetransfer')
        ) {
          await supabasePost('download_commands', {
            machine_name: project.assigned_machine,
            command: 'add_to_cloud',
            project_id: pid,
            payload: {
              download_link: project.download_link,
              link_type: project.link_type,
              couple_name: project.couple_name || '',
              cloud_account_id: project.cloud_account_id || null,
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
            cloud_account_id: project.cloud_account_id || null,
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
