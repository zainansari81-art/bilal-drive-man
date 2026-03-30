import { supabasePost } from '../../lib/supabase';
import { requireAuth, sanitizeString } from '../../lib/auth';

function detectLinkType(url) {
  if (!url) return 'unknown';
  if (url.includes('dropbox.com')) return 'dropbox';
  if (url.includes('drive.google.com')) return 'google_drive';
  if (url.includes('we.tl') || url.includes('wetransfer.com')) return 'wetransfer';
  return 'unknown';
}

function getPropertyValue(page, ...names) {
  for (const name of names) {
    const prop = page.properties[name];
    if (!prop) continue;

    if (prop.type === 'title' && prop.title?.length > 0) {
      return prop.title[0].plain_text;
    }
    if (prop.type === 'rich_text' && prop.rich_text?.length > 0) {
      // Check for href (link) first, then plain text
      const item = prop.rich_text[0];
      if (item.href) return item.href;
      return item.plain_text;
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
    if (prop.type === 'files' && prop.files?.length > 0) {
      return prop.files[0].external?.url || prop.files[0].file?.url || null;
    }
    if (prop.type === 'multi_select' && prop.multi_select?.length > 0) {
      return prop.multi_select.map(s => s.name).join(', ');
    }
  }
  return null;
}

// Resolve relation IDs to page titles
async function resolveRelationNames(relationIds, notionApiKey) {
  if (!relationIds || relationIds.length === 0) return null;

  const names = [];
  for (const rel of relationIds) {
    try {
      const response = await fetch(`https://api.notion.com/v1/pages/${rel.id}`, {
        headers: {
          'Authorization': `Bearer ${notionApiKey}`,
          'Notion-Version': '2022-06-28',
        },
      });
      if (response.ok) {
        const page = await response.json();
        // Find the title property
        for (const prop of Object.values(page.properties)) {
          if (prop.type === 'title' && prop.title?.length > 0) {
            names.push(prop.title[0].plain_text);
            break;
          }
        }
      }
    } catch (e) {
      console.error('Failed to resolve relation:', rel.id, e);
    }
  }
  return names.length > 0 ? names.join(', ') : null;
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

    // Query all pages from the Notion database
    let allPages = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const body = { page_size: 100 };
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

    // Cache resolved client names to avoid duplicate API calls
    const clientNameCache = {};
    let synced = 0;
    let skipped = 0;

    for (const page of allPages) {
      // "Name" is the title column (couple/project name)
      const coupleName = getPropertyValue(page, 'Name');

      // "Client name" is a relation — resolve to actual name
      const clientRelation = page.properties['Client name']?.relation || [];
      let clientName = null;
      if (clientRelation.length > 0) {
        const cacheKey = clientRelation[0].id;
        if (clientNameCache[cacheKey]) {
          clientName = clientNameCache[cacheKey];
        } else {
          clientName = await resolveRelationNames(clientRelation, NOTION_API_KEY);
          if (clientName) clientNameCache[cacheKey] = clientName;
        }
      }

      // "Raw Data" contains Dropbox/Google Drive/WeTransfer links
      const downloadLink = getPropertyValue(page, 'Raw Data');

      // "progress" is a status field
      const progress = getPropertyValue(page, 'progress');

      // "Due" is the due date
      const dueDate = getPropertyValue(page, 'Due');

      // "Hard Drive" is multi-select with drive names
      const hardDrive = getPropertyValue(page, 'Hard Drive');

      // "Size in Gbs"
      const sizeGb = getPropertyValue(page, 'Size in Gbs');

      // "Date" is the project date
      const projectDate = getPropertyValue(page, 'Date');

      if (!clientName && !coupleName) {
        skipped++;
        continue;
      }

      const projectData = {
        notion_page_id: page.id,
        client_name: sanitizeString(clientName || 'Unknown'),
        couple_name: sanitizeString(coupleName || 'Unknown'),
      };

      if (downloadLink) {
        projectData.download_link = sanitizeString(downloadLink, 2048);
        projectData.link_type = detectLinkType(downloadLink);
      }

      if (hardDrive) {
        projectData.target_drive = sanitizeString(hardDrive);
      }

      // Map Notion progress status to download_status
      if (progress) {
        const p = progress.toLowerCase();
        if (p.includes('downloaded') || p.includes('delivered') || p.includes('done') || p.includes('success')) {
          projectData.download_status = 'completed';
        } else if (p.includes('downloading')) {
          projectData.download_status = 'downloading';
        } else if (p.includes('not started') || p.includes('pending') || p.includes('not download')) {
          projectData.download_status = 'idle';
        } else if (p.includes('in progress') || p.includes('editing') || p.includes('in revision')) {
          projectData.download_status = 'completed'; // Already have the files
        }
      }

      await supabasePost('download_projects', projectData, 'notion_page_id');
      synced++;
    }

    return res.status(200).json({ synced, skipped, total: allPages.length });
  } catch (err) {
    console.error('Notion Sync API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
