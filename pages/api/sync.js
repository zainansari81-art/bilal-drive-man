import { addHistory, supabasePost, supabasePatch, supabaseFetch } from '../../lib/supabase';
import { requireApiKey, sanitizeString, validatePositiveNumber } from '../../lib/auth';
import { updateNotionProjectStatus } from '../../lib/notion';

/**
 * Auto-reset on couple-folder deletion (Option A — companion to manual
 * `?action=reset` on /api/download-projects).
 *
 * When a previously-present couple folder disappears from a connected
 * drive (the surrounding sync handler flips `couples.is_present` to
 * false), check whether any matching `download_projects` row should be
 * unlocked for re-download. The trigger:
 *   - There exists a download_projects row with download_status='completed'
 *     and matching couple_name (case-insensitive trimmed match).
 *   - No other connected drive currently has the same couple folder
 *     present (count of `couples` rows with is_present=true on a drive
 *     where is_connected=true equals zero for that couple_name).
 *
 * If both hold, reset the project: clear download_status / phase /
 * progress / cloud_folder_path / completed_at / error_message, and
 * mirror 'idle' to Notion so Bilal sees the project as ready-to-pull
 * again. This catches the workflow where Bilal deletes the local copy
 * after a few days and a client later delivers changes — the project
 * becomes downloadable again automatically without him touching the UI.
 *
 * Best-effort: any error is logged but doesn't abort the surrounding
 * sync (the drive scan is the user-visible operation; reset is a
 * janitor pass).
 */
async function autoResetCompletedProjects(removedCoupleNames) {
  if (!removedCoupleNames || removedCoupleNames.size === 0) return 0;

  let resetCount = 0;
  try {
    // Cache: which couple_names are still alive somewhere (any connected
    // drive). Single query covering all the names we removed in this
    // sync, instead of N round-trips.
    const namesArr = Array.from(removedCoupleNames);
    const inList = namesArr
      .map(n => `"${n.replace(/"/g, '\\"')}"`)
      .join(',');
    const aliveCouples = await supabaseFetch(
      `couples?couple_name=in.(${encodeURIComponent(inList)})` +
        `&is_present=eq.true&select=couple_name,client:clients(drive:drives(is_connected))`
    );
    const aliveSomewhere = new Set();
    for (const c of aliveCouples || []) {
      if (c.client?.drive?.is_connected === true) {
        aliveSomewhere.add((c.couple_name || '').trim().toLowerCase());
      }
    }

    // Names that are now dead everywhere — candidates for project reset.
    const deadNames = namesArr.filter(
      n => !aliveSomewhere.has((n || '').trim().toLowerCase())
    );
    if (deadNames.length === 0) return 0;

    const deadInList = deadNames
      .map(n => `"${n.replace(/"/g, '\\"')}"`)
      .join(',');
    const candidates = await supabaseFetch(
      `download_projects?couple_name=in.(${encodeURIComponent(deadInList)})` +
        `&download_status=eq.completed` +
        `&select=id,couple_name,notion_page_id`
    );

    for (const proj of candidates || []) {
      try {
        await supabasePatch(`download_projects?id=eq.${proj.id}`, {
          download_status: 'idle',
          download_phase: null,
          progress_bytes: 0,
          total_bytes_expected: null,
          cloud_status: 'pending',
          cloud_folder_path: null,
          error_message: null,
          completed_at: null,
        });
        if (proj.notion_page_id) {
          updateNotionProjectStatus(proj.notion_page_id, 'idle').catch(() => {});
        }
        resetCount++;
        console.log(
          `[auto-reset] Project ${proj.id} (couple="${proj.couple_name}") ` +
          `reset to idle: no connected drive has this couple folder present.`
        );
      } catch (e) {
        console.error(
          `[auto-reset] Failed to reset project ${proj.id}:`, e.message
        );
      }
    }
  } catch (e) {
    console.error('[auto-reset] Outer error (sync continues):', e.message);
  }
  return resetCount;
}

async function supabaseGet(path) {
  return supabaseFetch(path);
}

export default requireApiKey(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { drive, clients } = req.body;

    if (!drive || !drive.volume_label) {
      return res.status(400).json({ error: 'drive.volume_label is required' });
    }

    // Input validation
    const volumeLabel = sanitizeString(drive.volume_label, 128);
    const machineName = sanitizeString(drive.source_machine || 'Unknown', 128);

    // Upsert drive
    const driveResult = await supabasePost('drives', {
      volume_label: volumeLabel,
      total_size_bytes: validatePositiveNumber(drive.total_size_bytes),
      used_bytes: validatePositiveNumber(drive.used_bytes),
      free_bytes: validatePositiveNumber(drive.free_bytes),
      is_connected: true,
      drive_letter: sanitizeString(drive.drive_letter || '', 10),
      source_machine: machineName,
      last_seen: new Date().toISOString(),
      last_scan: new Date().toISOString(),
    }, 'volume_label');

    const driveId = driveResult?.[0]?.id;
    if (!driveId) {
      return res.status(500).json({ error: 'Failed to upsert drive' });
    }

    let foldersAdded = 0;
    let foldersUpdated = 0;
    let foldersRemoved = 0;

    if (clients && Array.isArray(clients)) {
      const currentCoupleKeys = new Set();

      // Batch upsert all clients at once
      const clientRows = clients.map(c => ({
        drive_id: driveId,
        client_name: sanitizeString(c.name, 255),
      }));
      let clientResults;
      try {
        clientResults = await supabasePost('clients', clientRows, 'drive_id,client_name');
      } catch (e) {
        console.error('Client batch upsert failed, trying one by one:', e.message);
        clientResults = [];
        for (const row of clientRows) {
          try {
            const r = await supabasePost('clients', row, 'drive_id,client_name');
            if (Array.isArray(r)) clientResults.push(...r);
            else if (r) clientResults.push(r);
          } catch (e2) {
            console.error(`Client upsert failed for ${row.client_name}:`, e2.message);
          }
        }
      }

      // Build client name -> id map
      const clientMap = {};
      if (Array.isArray(clientResults)) {
        for (const cr of clientResults) {
          clientMap[cr.client_name] = cr.id;
        }
      }

      // Batch upsert all couples at once
      const coupleRows = [];
      const coupleInfo = [];
      for (const client of clients) {
        const clientId = clientMap[sanitizeString(client.name, 255)];
        if (!clientId) continue;

        for (const couple of client.couples || []) {
          const coupleName = sanitizeString(couple.name, 255);
          currentCoupleKeys.add(`${clientId}:${coupleName}`);
          coupleRows.push({
            client_id: clientId,
            couple_name: coupleName,
            size_bytes: validatePositiveNumber(couple.size),
            file_count: validatePositiveNumber(couple.file_count),
            last_seen: new Date().toISOString(),
            is_present: true,
          });
          coupleInfo.push({ clientName: client.name, coupleName: couple.name });
        }
      }

      // Get existing couples for current clients to detect new vs changed
      const currentClientIds = Object.values(clientMap).filter(Boolean);
      let existingCouples = [];
      if (currentClientIds.length > 0) {
        existingCouples = await supabaseGet(`couples?client_id=in.(${currentClientIds.join(',')})`);
      }
      const existingMap = {};
      for (const ec of existingCouples) {
        existingMap[`${ec.client_id}:${ec.couple_name}`] = ec;
      }

      // Upsert all couples in one batch
      if (coupleRows.length > 0) {
        for (const row of coupleRows) {
          const key = `${row.client_id}:${row.couple_name}`;
          if (!existingMap[key]) {
            row.first_seen = new Date().toISOString();
          }
        }
        try {
          await supabasePost('couples', coupleRows, 'client_id,couple_name');
        } catch (e) {
          console.error('Couple batch upsert failed, trying one by one:', e.message);
          for (const row of coupleRows) {
            try {
              await supabasePost('couples', row, 'client_id,couple_name');
            } catch (e2) {
              console.error(`Couple upsert failed for ${row.couple_name}:`, e2.message);
            }
          }
        }
      }

      // Log history for new and changed couples
      const historyEntries = [];
      for (let i = 0; i < coupleRows.length; i++) {
        const row = coupleRows[i];
        const info = coupleInfo[i];
        const key = `${row.client_id}:${row.couple_name}`;
        const existing = existingMap[key];

        if (!existing) {
          foldersAdded++;
          historyEntries.push({
            drive_id: driveId,
            volume_label: volumeLabel,
            event_type: 'folder_added',
            folder_name: `${info.clientName} / ${info.coupleName}`,
            details: `New couple added to ${volumeLabel} from ${machineName}`,
          });
        } else {
          const sizeChanged = Math.abs((existing.size_bytes || 0) - (row.size_bytes || 0)) > 1024 * 1024;
          if (sizeChanged) {
            historyEntries.push({
              drive_id: driveId,
              volume_label: volumeLabel,
              event_type: 'size_changed',
              folder_name: `${info.clientName} / ${info.coupleName}`,
              details: `Size changed on ${volumeLabel} from ${machineName}`,
            });
          }
          foldersUpdated++;
        }
      }

      // Get ALL clients for this drive (including ones no longer in scan)
      const allDriveClients = await supabaseGet(`clients?drive_id=eq.${driveId}`);
      const allClientIds = allDriveClients.map(c => c.id).filter(Boolean);

      // Get ALL couples for this drive (not just current scan's clients)
      let allDriveCouples = [];
      if (allClientIds.length > 0) {
        allDriveCouples = await supabaseGet(`couples?client_id=in.(${allClientIds.join(',')})`);
      }

      // Build reverse map: client_id -> client_name
      const clientIdToName = {};
      for (const c of allDriveClients) {
        clientIdToName[c.id] = c.client_name;
      }

      // Check for removed couples across ALL clients on this drive
      for (const ec of allDriveCouples) {
        if (ec.is_present && !currentCoupleKeys.has(`${ec.client_id}:${ec.couple_name}`)) {
          foldersRemoved++;
          historyEntries.push({
            drive_id: driveId,
            volume_label: volumeLabel,
            event_type: 'folder_removed',
            folder_name: `${clientIdToName[ec.client_id] || ''} / ${ec.couple_name}`,
            details: `Removed from ${volumeLabel} (${machineName})`,
          });
        }
      }

      // Mark removed couples
      const removedCoupleNames = new Set();
      if (foldersRemoved > 0) {
        for (const ec of allDriveCouples) {
          if (ec.is_present && !currentCoupleKeys.has(`${ec.client_id}:${ec.couple_name}`)) {
            await supabasePatch(`couples?id=eq.${ec.id}`, {
              is_present: false,
              last_seen: new Date().toISOString(),
            });
            removedCoupleNames.add(ec.couple_name);
          }
        }
      }

      // Auto-reset completed download_projects whose only copy was on
      // this drive (Option A). Best-effort, never aborts the sync.
      const resetCount = await autoResetCompletedProjects(removedCoupleNames);
      if (resetCount > 0) {
        try {
          await addHistory({
            drive_id: driveId,
            volume_label: volumeLabel,
            event_type: 'projects_auto_reset',
            details: `Auto-reset ${resetCount} completed project(s) — couple folder no longer present on any connected drive. They are now downloadable again.`,
          });
        } catch (e) {
          console.error('[auto-reset] history insert failed:', e.message);
        }
      }

      // Batch insert all history entries
      if (historyEntries.length > 0) {
        try {
          await supabasePost('history', historyEntries);
        } catch (e) {
          console.error('History batch insert failed:', e.message);
        }
      }
    }

    // Log drive connection
    await addHistory({
      drive_id: driveId,
      volume_label: volumeLabel,
      event_type: 'drive_connected',
      details: `Drive scanned from ${machineName}. Added: ${foldersAdded}, Updated: ${foldersUpdated}, Removed: ${foldersRemoved}`,
    });

    return res.status(200).json({
      success: true,
      drive_id: driveId,
      stats: { foldersAdded, foldersUpdated, foldersRemoved },
    });
  } catch (err) {
    console.error('Sync API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
