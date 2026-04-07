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

// Resolve a batch of relation IDs in parallel (max 5 concurrent)
async function resolveRelationsBatch(uniqueIds, notionApiKey) {
  const cache = {};
  const BATCH_SIZE = 5;

  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        const response = await fetch(`https://api.notion.com/v1/pages/${id}`, {
          headers: {
            'Authorization': `Bearer ${notionApiKey}`,
            'Notion-Version': '2022-06-28',
          },
        });
        if (response.ok) {
          const page = await response.json();
          for (const prop of Object.values(page.properties)) {
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
        cache[r.value.id] = r.value.name;
      }
    }
  }
  return cache;
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

    // Step 1: Fetch ALL pages from Notion (paginated)
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

    // Step 2: Collect unique client relation IDs and resolve them in parallel
    const uniqueRelationIds = new Set();
    for (const page of allPages) {
      const relation = page.properties['Client name']?.relation || [];
      if (relation.length > 0) uniqueRelationIds.add(relation[0].id);
    }
    const clientNameCache = await resolveRelationsBatch([...uniqueRelationIds], NOTION_API_KEY);

    // Step 3: Fetch all existing project statuses in one query (to avoid 1000 individual lookups)
    const activeStatuses = ['downloading', 'queued', 'copying', 'paused'];
    let existingStatusMap = {};
    try {
      const existing = await supabaseFetch(
        'download_projects?select=notion_page_id,download_status'
      );
      for (const row of existing || []) {
        if (row.notion_page_id) {
          existingStatusMap[row.notion_page_id] = row.download_status;
        }
      }
    } catch (e) {
      console.error('Failed to fetch existing statuses:', e.message);
    }

    // Step 4: Build all project rows
    const projectRows = [];
    for (const page of allPages) {
      const projectName = getTextValue(page, 'Name');
      if (!projectName) continue;

      const clientRelation = page.properties['Client name']?.relation || [];
      const clientId = clientRelation.length > 0 ? clientRelation[0].id : null;
      const clientName = clientId ? (clientNameCache[clientId] || 'Unknown') : 'Unknown';

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
        const currentStatus = existingStatusMap[page.id];
        if (!currentStatus || !activeStatuses.includes(currentStatus)) {
          projectData.download_status = notionStatus;
        }
      }

      projectRows.push(projectData);
    }

    // Step 5: Batch upsert to Supabase in chunks of 50
    let synced = 0;
    const errors = [];
    const CHUNK_SIZE = 50;

    for (let i = 0; i < projectRows.length; i += CHUNK_SIZE) {
      const chunk = projectRows.slice(i, i + CHUNK_SIZE);
      try {
        await supabasePost('download_projects', chunk, 'notion_page_id');
        synced += chunk.length;
      } catch (batchErr) {
        console.error(`Batch upsert failed for chunk ${i}-${i + chunk.length}:`, batchErr.message);
        // Fallback: try one-by-one for this chunk
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

    return res.status(200).json({ synced, total: allPages.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('Notion Sync API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});
