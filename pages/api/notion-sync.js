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
  if (prop.type === 'url' && prop.url) {
    return prop.url;
  }
  if (prop.type === 'select' && prop.select) {
    return prop.select.name;
  }
  if (prop.type === 'status' && prop.status) {
    return prop.status.name;
  }
  if (prop.type === 'date' && prop.date) {
    return prop.date.start;
  }
  if (prop.type === 'multi_select' && prop.multi_select?.length > 0) {
    return prop.multi_select.map(s => s.name).join(', ');
  }
  return null;
}

function mapNotionStatus(progress) {
  if (!progress) return null;
  const p = progress.toLowerCase();
  if (p === 'not downloaded') return 'idle';
  if (p === 'downloading') return 'downloading';
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

    // Step 1: Fetch existing projects from DB (client names + statuses) — one fast query
    // This avoids resolving relations for projects we already know
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

    // Step 2: Fetch ALL pages from Notion (paginated)
    let allPages = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const body = { page_size: 100 };
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

    // Step 3: Find NEW relation IDs that we haven't resolved yet
    // Only resolve client names for projects not already in our DB
    const newRelationIds = new Set();
    for (const page of allPages) {
      const relation = page.properties['Client name']?.relation || [];
      if (relation.length > 0) {
        const existing = existingProjects[page.id];
        // Only resolve if project is new OR client is still 'Unknown'
        if (!existing || existing.clientName === 'Unknown') {
          newRelationIds.add(relation[0].id);
        }
      }
    }

    // Resolve only NEW relations in parallel (max 10 concurrent)
    const clientNameCache = {};
    if (newRelationIds.size > 0) {
      const idsToResolve = [...newRelationIds];
      const BATCH_SIZE = 10;
      for (let i = 0; i < idsToResolve.length; i += BATCH_SIZE) {
        const batch = idsToResolve.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (id) => {
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
    }

    // Step 4: Build project rows
    const activeStatuses = ['downloading', 'queued', 'copying', 'paused'];
    const projectRows = [];

    for (const page of allPages) {
      const projectName = getTextValue(page, 'Name');
      if (!projectName) continue;

      // Get client name: use DB cache first, then newly resolved, then 'Unknown'
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

      const downloadLink = getTextValue(page, 'Raw Data');
      const progress = getTextValue(page, 'progress');
      const projectDate = getTextValue(page, 'Date');
      const sizeGb = getTextValue(page, 'Size in Gbs');
      const hardDrive = getTextValue(page, 'Hard Drive');

      const projectData = {
        notion_page_id: page.id,
        couple_name: sanitizeString(projectName),
        client_name: sanitizeString(clientName),
      };

      if (downloadLink) {
        projectData.download_link = sanitizeString(downloadLink, 2048);
        projectData.link_type = detectLinkType(downloadLink);
      }
      if (projectDate) projectData.project_date = projectDate;
      if (sizeGb) projectData.size_gb = sanitizeString(sizeGb);
      if (hardDrive) projectData.target_drive = sanitizeString(hardDrive);

      // Map Notion progress to download_status (skip if dashboard is actively managing)
      const notionStatus = mapNotionStatus(progress);
      if (notionStatus) {
        const currentStatus = existingProject?.status;
        if (!currentStatus || !activeStatuses.includes(currentStatus)) {
          projectData.download_status = notionStatus;
        }
      }

      projectRows.push(projectData);
    }

    // Step 5: Batch upsert to Supabase in chunks of 100
    let synced = 0;
    const errors = [];
    const CHUNK_SIZE = 100;

    for (let i = 0; i < projectRows.length; i += CHUNK_SIZE) {
      const chunk = projectRows.slice(i, i + CHUNK_SIZE);
      try {
        await supabasePost('download_projects', chunk, 'notion_page_id');
        synced += chunk.length;
      } catch (batchErr) {
        console.error(`Batch upsert failed for chunk ${i}-${i + chunk.length}:`, batchErr.message);
        // Fallback: try one-by-one
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

    return res.status(200).json({
      synced,
      total: allPages.length,
      newClients: newRelationIds.size,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Notion Sync API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});
