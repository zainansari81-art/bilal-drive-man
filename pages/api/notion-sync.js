import { supabasePost, supabaseFetch } from '../../lib/supabase';
import { requireAuth, sanitizeString } from '../../lib/auth';

function detectLinkType(url) {
  if (!url) return 'unknown';
  if (url.includes('dropbox.com')) return 'dropbox';
  if (url.includes('drive.google.com')) return 'google_drive';
  if (url.includes('we.tl') || url.includes('wetransfer.com')) return 'wetransfer';
  return 'unknown';
}

function getTextValue(page, propName) {
  const prop = page.properties[propName];
  if (!prop) return null;

  if (prop.type === 'title' && prop.title?.length > 0) {
    return prop.title.map(t => t.plain_text).join('');
  }
  if (prop.type === 'rich_text' && prop.rich_text?.length > 0) {
    const withHref = prop.rich_text.find(t => t.href);
    if (withHref) return withHref.href;
    return prop.rich_text.map(t => t.plain_text).join('');
  }
  if (prop.type === 'url' && prop.url) return prop.url;
  if (prop.type === 'select' && prop.select) return prop.select.name;
  if (prop.type === 'status' && prop.status) return prop.status.name;
  if (prop.type === 'date' && prop.date) return prop.date.start;
  if (prop.type === 'multi_select' && prop.multi_select?.length > 0) {
    return prop.multi_select.map(s => s.name).join(', ');
  }
  return null;
}

function mapNotionStatus(progress) {
  if (!progress) return null;
  const p = progress.toLowerCase().trim();
  if (p === 'not downloaded') return 'idle';
  if (p === 'downloading') return 'downloading';
  if (p === 'copying') return 'copying';
  if (p === 'downloaded') return 'completed';
  if (p === 'cancelled' || p === 'canceled') return 'idle';
  if (p === 'failed') return 'failed';
  return null;
}

export default requireAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const NOTION_API_KEY = process.env.NOTION_API_KEY;
    const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

    if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
      return res.status(500).json({ error: 'Notion integration not configured' });
    }

    // Step 1: Fetch existing projects from DB (for client name cache + status protection)
    let existingProjects = {};
    try {
      const existing = await supabaseFetch(
        'download_projects?select=notion_page_id,client_name,download_status'
      );
      for (const row of existing || []) {
        if (row.notion_page_id) {
          existingProjects[row.notion_page_id] = {
            clientName: row.client_name,
            status: row.download_status,
          };
        }
      }
    } catch (e) {
      console.error('Failed to fetch existing projects:', e.message);
    }

    // Step 2: Fetch pages from Notion
    // Only fetch projects whose project Date is within the last MAX_AGE_DAYS.
    // Filtering on the Notion "Date" property (shoot date) — NOT last_edited_time,
    // so an old project being edited doesn't leak through.
    const MAX_AGE_DAYS = 50;
    const cutoffISO = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10); // YYYY-MM-DD for Notion date filter

    let allPages = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const body = {
        page_size: 100,
        // Only filter by date — NOT by status. We want every project in the
        // window to come back so Supabase mirrors whatever Notion says,
        // including "Downloaded", "Failed", "Cancelled" etc. Without that,
        // flipping a project from Downloading → Downloaded in Notion would
        // leave Supabase stuck on "downloading".
        filter: {
          property: 'Date',
          date: { on_or_after: cutoffISO },
        },
        sorts: [{ property: 'Date', direction: 'descending' }],
      };
      if (startCursor) body.start_cursor = startCursor;

      const response = await fetch(
        `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error('Notion API error:', response.status, errText);
        return res.status(502).json({ error: 'Failed to fetch from Notion' });
      }

      const data = await response.json();
      allPages = allPages.concat(data.results || []);
      hasMore = data.has_more;
      startCursor = data.next_cursor;
    }

    // Step 3: Resolve client names for NEW projects only
    const clientNameCache = {};
    const newRelationIds = new Set();
    for (const page of allPages) {
      const relation = page.properties['Client name']?.relation || [];
      if (relation.length > 0) {
        const existing = existingProjects[page.id];
        if (!existing || existing.clientName === 'Unknown') {
          newRelationIds.add(relation[0].id);
        }
      }
    }

    if (newRelationIds.size > 0) {
      const idsToResolve = [...newRelationIds];
      // Resolve all at once in parallel (should be small number for incremental sync)
      const results = await Promise.allSettled(
        idsToResolve.map(async (id) => {
          const resp = await fetch(`https://api.notion.com/v1/pages/${id}`, {
            headers: {
              'Authorization': `Bearer ${NOTION_API_KEY}`,
              'Notion-Version': '2022-06-28',
            },
          });
          if (resp.ok) {
            const pg = await resp.json();
            for (const prop of Object.values(pg.properties)) {
              if (prop.type === 'title' && prop.title?.length > 0) {
                return { id, name: prop.title.map(t => t.plain_text).join('') };
              }
            }
          }
          return { id, name: null };
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.name) {
          clientNameCache[r.value.id] = r.value.name;
        }
      }
    }

    // Step 4: Build project rows. Notion is the source of truth for status —
    // whatever progress value Notion has wins, no "protect the active state"
    // carve-outs. Portal actions (Download, pause, etc.) write back to Notion
    // so the next sync sees the right status and doesn't revert anything.
    const projectRows = [];
    let skippedIncomplete = 0;

    for (const page of allPages) {
      const projectName = getTextValue(page, 'Name');
      if (!projectName) continue;

      const downloadLink = getTextValue(page, 'Raw Data');

      const existingProject = existingProjects[page.id];
      let clientName = 'Unknown';
      if (existingProject && existingProject.clientName !== 'Unknown') {
        clientName = existingProject.clientName;
      } else {
        const relation = page.properties['Client name']?.relation || [];
        if (relation.length > 0) {
          clientName = clientNameCache[relation[0].id] || 'Unknown';
        }
      }

      // Detect what's missing so the row can tell the user to fix it in Notion
      let incompleteError = null;
      if (!downloadLink) {
        incompleteError = 'ERROR; DOWNLOADING LINK IS MISSING';
      } else if (clientName === 'Unknown') {
        incompleteError = 'ERROR; CLIENT NAME IS MISSING';
      }

      const progress = getTextValue(page, 'progress');
      const projectDate = getTextValue(page, 'Date');
      const sizeGb = getTextValue(page, 'Size in Gbs');
      const hardDrive = getTextValue(page, 'Hard Drive');

      // CRITICAL: every row in the bulk upsert MUST have the exact same set
      // of keys — PostgREST rejects the whole batch with PGRST102
      // ("All object keys must match") if key sets differ between rows.
      // Always include every nullable column, use null where we don't have a
      // value. Don't add columns conditionally.
      const projectData = {
        notion_page_id: page.id,
        couple_name: sanitizeString(projectName),
        // client_name column is NOT NULL — fall back to 'Unknown' for display
        client_name: sanitizeString(clientName),
        // download_link column is nullable; null = "blank" in the UI
        download_link: downloadLink ? sanitizeString(downloadLink, 2048) : null,
        link_type: detectLinkType(downloadLink),
        project_date: projectDate || null,
        size_gb: sizeGb ? sanitizeString(sizeGb) : null,
        target_drive: hardDrive ? sanitizeString(hardDrive) : null,
        error_message: null,
        download_status: null,
      };

      if (incompleteError) {
        skippedIncomplete++;
        projectData.error_message = incompleteError;
        projectData.download_status = 'failed';
      } else {
        // Notion wins — whatever the user set in Notion is the truth.
        const notionStatus = mapNotionStatus(progress);
        if (notionStatus) {
          projectData.download_status = notionStatus;
        } else if (existingProject?.status) {
          // Notion status didn't map to any known value — keep the existing
          // Supabase status rather than nulling it out (download_status is
          // likely NOT NULL; nulling would 400 the upsert anyway).
          projectData.download_status = existingProject.status;
        } else {
          // Brand-new project with no recognized Notion status → default idle
          projectData.download_status = 'idle';
        }
      }

      projectRows.push(projectData);
    }

    // Step 5: Batch upsert to Supabase
    let synced = 0;
    const errors = [];

    if (projectRows.length > 0) {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < projectRows.length; i += CHUNK_SIZE) {
        const chunk = projectRows.slice(i, i + CHUNK_SIZE);
        try {
          await supabasePost('download_projects', chunk, 'notion_page_id');
          synced += chunk.length;
        } catch (batchErr) {
          console.error(`Batch upsert failed:`, batchErr.message);
          for (const row of chunk) {
            try {
              await supabasePost('download_projects', row, 'notion_page_id');
              synced++;
            } catch (rowErr) {
              errors.push(`${row.couple_name}: ${rowErr.message}`);
            }
          }
        }
      }
    }

    // Step 6: Clean up projects not in current Notion results
    //  a) Inactive (idle/completed/failed) projects not returned by Notion
    //  b) Projects whose project_date is older than the age cutoff — regardless
    //     of status. Enforces the "max N days old" rule on already-stored rows
    //     that predate this filter.
    let cleaned = 0;
    try {
      const syncedNotionIds = new Set(projectRows.map(r => r.notion_page_id));
      const cleanableStatuses = ['idle', 'completed', 'failed'];
      const cutoffDate = cutoffISO; // YYYY-MM-DD

      // Get all existing projects from DB (include project_date for age check)
      const allExisting = await supabaseFetch(
        'download_projects?select=id,notion_page_id,download_status,project_date'
      );

      const idsToDelete = [];
      for (const row of allExisting || []) {
        if (!row.notion_page_id) continue;
        if (syncedNotionIds.has(row.notion_page_id)) continue;

        const isInactive = cleanableStatuses.includes(row.download_status);
        const isTooOld = row.project_date && row.project_date < cutoffDate;

        if (isInactive || isTooOld) {
          idsToDelete.push(row.id);
        }
      }

      if (idsToDelete.length > 0) {
        // Delete in batches
        const DEL_CHUNK = 50;
        for (let i = 0; i < idsToDelete.length; i += DEL_CHUNK) {
          const chunk = idsToDelete.slice(i, i + DEL_CHUNK);
          const idList = chunk.join(',');
          await supabaseFetch(`download_projects?id=in.(${idList})`, {
            method: 'DELETE',
            prefer: 'return=minimal',
          });
          cleaned += chunk.length;
        }
      }
    } catch (cleanErr) {
      console.error('Cleanup of old projects failed:', cleanErr.message);
    }

    return res.status(200).json({
      synced,
      cleaned,
      total: allPages.length,
      skippedIncomplete,
      newClients: newRelationIds.size,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Notion Sync API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
