/**
 * Tiny Notion client used by the web-app to write project status back to
 * Notion. Reads use the raw fetch calls already in pages/api/notion-sync.js;
 * this module focuses on writes.
 *
 * Required env:
 *   NOTION_API_KEY — integration token with "Update content" permission on
 *   the projects database. If the integration only has read access, writes
 *   will 403 and log silently — the portal keeps working, Notion just won't
 *   reflect changes made in the portal until the user updates it by hand.
 */

const NOTION_VERSION = '2022-06-28';

// Map our internal download_status values to the exact Notion status names.
// The trailing space on 'copying ' is NOT a typo — it matches what's
// currently configured in the Notion database. Keep in sync with
// mapNotionStatus() in pages/api/notion-sync.js.
const STATUS_TO_NOTION = {
  idle: 'Not Downloaded',
  downloading: 'Downloading',
  copying: 'copying ',
  completed: 'Downloaded',
  failed: 'Failed',
  // 'queued' and 'paused' have no Notion equivalent — treat as 'Downloading'
  // so Notion doesn't revert the project to 'Not Downloaded' on next sync.
  queued: 'Downloading',
  paused: 'Downloading',
};

/**
 * Update the `progress` status property on a Notion page.
 *
 * @param {string} pageId — Notion page UUID (stored as notion_page_id)
 * @param {string} internalStatus — one of our download_status values
 * @returns {Promise<boolean>} true if Notion accepted the update
 *
 * NEVER throws — Notion write failures must not break portal actions.
 * All errors are logged and swallowed.
 */
export async function updateNotionProjectStatus(pageId, internalStatus) {
  if (!pageId || !internalStatus) return false;

  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.warn('updateNotionProjectStatus: NOTION_API_KEY not set, skipping');
    return false;
  }

  const notionStatus = STATUS_TO_NOTION[internalStatus];
  if (!notionStatus) {
    console.warn(`updateNotionProjectStatus: no Notion mapping for "${internalStatus}"`);
    return false;
  }

  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          progress: {
            status: { name: notionStatus },
          },
        },
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error(
        `Notion status write failed for ${pageId} (${internalStatus} → "${notionStatus}"):`,
        res.status,
        txt.slice(0, 300)
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Notion status write threw for ${pageId}:`, err.message);
    return false;
  }
}
