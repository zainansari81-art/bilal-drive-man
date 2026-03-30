import { supabasePost } from '../../lib/supabase';
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
    // Check for href (clickable link) first
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

// Resolve relation IDs to page titles (with caching)
async function resolveRelationName(relationArr, cache, notionApiKey) {
  if (!relationArr || relationArr.length === 0) return null;

  const id = relationArr[0].id;
  if (cache[id]) return cache[id];

  try {
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
          const name = prop.title.map(t => t.plain_text).join('');
          cache[id] = name;
          return name;
        }
      }
    }
  } catch (e) {
    console.error('Failed to resolve relation:', id, e);
  }
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

    // Only fetch projects with "Not Downloaded" or "Downloading" status
    const filter = {
      or: [
        { property: 'progress', status: { equals: 'Not Downloaded' } },
        { property: 'progress', status: { equals: 'Downloading' } },
      ],
    };

    let allPages = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const body = { page_size: 100, filter };
      if (startCursor) {
        body.start_cursor = startCursor;
      }

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

    const clientNameCache = {};
    let synced = 0;
    const errors = [];

    for (const page of allPages) {
      // Project name = "Name" (title column)
      const projectName = getTextValue(page, 'Name');

      // Client name = resolve relation (with fallback on failure)
      const clientRelation = page.properties['Client name']?.relation || [];
      let clientName = null;
      try {
        clientName = await resolveRelationName(clientRelation, clientNameCache, NOTION_API_KEY);
      } catch (relErr) {
        console.error('Failed to resolve client name:', relErr);
      }

      // Raw Data = download link (Dropbox, Google Drive, WeTransfer)
      const downloadLink = getTextValue(page, 'Raw Data');

      // Progress status
      const progress = getTextValue(page, 'progress');

      // Date
      const projectDate = getTextValue(page, 'Date');

      // Size in GBs
      const sizeGb = getTextValue(page, 'Size in Gbs');

      // Hard Drive (target)
      const hardDrive = getTextValue(page, 'Hard Drive');

      if (!projectName) continue;

      const projectData = {
        notion_page_id: page.id,
        couple_name: sanitizeString(projectName),
        client_name: sanitizeString(clientName || 'Unknown'),
      };

      if (downloadLink) {
        projectData.download_link = sanitizeString(downloadLink, 2048);
        projectData.link_type = detectLinkType(downloadLink);
      }

      if (projectDate) {
        projectData.project_date = projectDate;
      }

      if (sizeGb) {
        projectData.size_gb = sanitizeString(sizeGb);
      }

      if (hardDrive) {
        projectData.target_drive = sanitizeString(hardDrive);
      }

      // Map progress to download_status
      if (progress) {
        const p = progress.toLowerCase();
        if (p === 'not downloaded') {
          projectData.download_status = 'idle';
        } else if (p === 'downloading') {
          projectData.download_status = 'downloading';
        }
      }

      try {
        await supabasePost('download_projects', projectData, 'notion_page_id');
        synced++;
      } catch (dbErr) {
        console.error('Supabase upsert error for', projectName, ':', dbErr);
        errors.push(`${projectName}: ${dbErr.message}`);
      }
    }

    return res.status(200).json({ synced, total: allPages.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('Notion Sync API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});
