import { supabasePost } from '../../lib/supabase';
import { requireAuth, sanitizeString } from '../../lib/auth';

function detectLinkType(url) {
  if (!url) return 'unknown';
  if (url.includes('dropbox.com')) return 'dropbox';
  if (url.includes('drive.google.com')) return 'google_drive';
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
      return prop.rich_text[0].plain_text;
    }
    if (prop.type === 'url' && prop.url) {
      return prop.url;
    }
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

    // Query all pages from the Notion database
    let allPages = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const body = {};
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

    let synced = 0;

    for (const page of allPages) {
      const clientName = getPropertyValue(page, 'Client Name', 'Client');
      const coupleName = getPropertyValue(page, 'Couple Name', 'Couple', 'Project Name');
      const downloadLink = getPropertyValue(page, 'Download Link', 'Link', 'URL');

      if (!clientName && !coupleName) continue;

      const projectData = {
        notion_page_id: page.id,
        client_name: sanitizeString(clientName || ''),
        couple_name: sanitizeString(coupleName || ''),
      };

      if (downloadLink) {
        projectData.download_link = sanitizeString(downloadLink, 2048);
        projectData.link_type = detectLinkType(downloadLink);
      }

      await supabasePost('download_projects', projectData, 'notion_page_id');
      synced++;
    }

    return res.status(200).json({ synced, total: allPages.length });
  } catch (err) {
    console.error('Notion Sync API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
