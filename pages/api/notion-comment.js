import { supabaseFetch } from '../../lib/supabase';
import { requireApiKey, sanitizeString } from '../../lib/auth';
import { addNotionComment } from '../../lib/notion';

/**
 * Scanner/agent endpoint: append a comment to a project's Notion card.
 * Body: { project_id?, page_id?, text }. Provide either project_id (we resolve
 * its notion_page_id) or a direct page_id. x-api-key protected.
 */
export default requireApiKey(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
  try {
    const { project_id, page_id, text } = req.body || {};
    const comment = sanitizeString(text, 2000);
    if (!comment) return res.status(400).json({ error: 'Missing text' });

    let pageId = null;
    if (typeof page_id === 'string' && /^[a-f0-9-]+$/i.test(page_id)) {
      pageId = page_id;
    } else if (typeof project_id === 'string' && /^[a-f0-9-]+$/i.test(project_id)) {
      const rows = await supabaseFetch(`download_projects?id=eq.${project_id}&select=notion_page_id`);
      pageId = rows?.[0]?.notion_page_id || null;
    }
    if (!pageId) return res.status(400).json({ error: 'No valid page_id/project_id' });

    const ok = await addNotionComment(pageId, comment);
    return res.status(ok ? 200 : 502).json({ ok });
  } catch (err) {
    console.error('notion-comment API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
