import { requireAuth } from '../../lib/auth';

/**
 * AI chat proxy — keeps the Anthropic API key server-side and relays
 * messages to Claude Opus. Accepts a conversation (array of
 * {role, content}) plus optional portal context (drives + history)
 * and returns the assistant's reply text.
 *
 * Body:
 *   {
 *     messages: [{ role: 'user' | 'assistant', content: string }, ...],
 *     context?: {
 *       drives?: Array<{ name, free, total, connected, clients: [...] }>,
 *       activities?: Array<{ event_type, folder_name, created_at, ... }>,
 *     }
 *   }
 *
 * Env:
 *   ANTHROPIC_API_KEY — required. Set on Vercel.
 */

const MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = 1024;

const PORTAL_GUIDE = `
You are the built-in assistant for "Bilal - Drive Man" — an internal portal that
tracks wedding-photography project data across external hard drives, download
PCs, and cloud storage. You help the operator use the portal and keep storage
tidy.

PAGES THE USER CAN NAVIGATE TO (left sidebar):
  • Dashboard    — overview: drive stats, charts, recent activity
  • Drives       — every connected external drive, each drive's clients/couples
                   and sizes, and a "Delete Data" action per folder
  • Devices      — the scanner PCs (download machines) registered with the
                   portal, their online status and cloud paths
  • Downloading-Pro — projects pulled from Notion that are being downloaded
                   from Dropbox / Google Drive onto a download PC and then
                   copied to a chosen drive. Has a wizard to pick PC + drive,
                   live phase display (pinning → syncing → copying →
                   completed), pause/resume/cancel, and a "Copy to Drive"
                   action once the cloud sync is done
  • Search       — search all couples across all drives
  • History      — chronological activity log: scans, downloads, deletions

KEY ACTIONS THE USER CAN TAKE:
  • Scan drives (sidebar button) — rescans all connected externals
  • Delete a folder (Drives page → drive → trash icon on a couple)
      This moves the folder to the PC's Recycle Bin via the scanner.
  • Download a project (Downloading-Pro → Download) — opens the wizard
  • Sync from Notion (Downloading-Pro → Sync from Notion)

HOUSEKEEPING RULE (important):
  Data older than 1 month should generally be considered for deletion to free
  up drive space. When the user asks what to clean up, or gives you the chance
  to suggest something, proactively look through the portal context you're
  given and name specific couples/folders whose project_date or completed_at
  is older than 30 days, so the user can decide whether to delete them.
  Be specific — cite couple name, client, drive, and approximate age in days.
  Never instruct the user to bypass confirmation; always point them at the
  Delete button in the Drives page (or Remove Project in Downloading-Pro) and
  let them confirm.

STYLE:
  • Be concise — short paragraphs, bullets where helpful.
  • Only answer what the user asked. Don't dump the whole guide unprompted.
  • If you don't have enough context to answer, say so and ask a follow-up.
  • Never fabricate folder names, dates, or sizes. Only use what's in the
    provided context.
`;

function buildContextBlock(context, now) {
  if (!context) return '';
  const lines = [];
  const nowMs = now.getTime();
  const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;

  if (Array.isArray(context.drives) && context.drives.length > 0) {
    lines.push('DRIVES SNAPSHOT:');
    for (const drive of context.drives.slice(0, 20)) {
      const connected = drive.connected ? 'connected' : 'disconnected';
      const free = drive.free != null ? `${(drive.free / 1e9).toFixed(0)}GB free` : '';
      const total = drive.total != null ? `${(drive.total / 1e9).toFixed(0)}GB total` : '';
      lines.push(`  - ${drive.name || '?'} (${connected}${free ? ', ' + free : ''}${total ? ' / ' + total : ''})`);
      const clients = Array.isArray(drive.clients) ? drive.clients.slice(0, 12) : [];
      for (const client of clients) {
        const couples = Array.isArray(client.couples) ? client.couples.slice(0, 12) : [];
        for (const couple of couples) {
          const date = couple.date || couple.project_date || couple.delivered_date;
          let ageNote = '';
          if (date) {
            const ms = nowMs - new Date(date).getTime();
            if (!isNaN(ms) && ms > 0) {
              const days = Math.floor(ms / (24 * 60 * 60 * 1000));
              const marker = ms > ONE_MONTH ? ' [>1 month old]' : '';
              ageNote = ` — ${days}d old${marker}`;
            }
          }
          const size = couple.size ? ` (${(couple.size / 1e9).toFixed(1)}GB)` : '';
          lines.push(`      · ${client.name || '?'} / ${couple.name || '?'}${size}${ageNote}`);
        }
      }
    }
  }

  if (Array.isArray(context.activities) && context.activities.length > 0) {
    lines.push('');
    lines.push('RECENT ACTIVITY (latest 10):');
    for (const ev of context.activities.slice(0, 10)) {
      const when = ev.created_at ? new Date(ev.created_at).toISOString().slice(0, 10) : '';
      lines.push(`  - ${when} ${ev.event_type || ''} ${ev.folder_name || ''} ${ev.volume_label ? '[' + ev.volume_label + ']' : ''}`);
    }
  }

  return lines.length ? `\n\n---\nLIVE PORTAL CONTEXT (as of ${now.toISOString().slice(0, 10)}):\n${lines.join('\n')}` : '';
}

export default requireAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on the server' });
  }

  try {
    const { messages, context } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Sanitize / cap: only keep role + string content, drop empties, and
    // limit total to protect against abuse. Anthropic needs alternating
    // user/assistant starting with user, so drop any leading assistant
    // messages (the UI seeds a greeting that's display-only) and collapse
    // consecutive same-role messages by keeping the latest.
    const raw = [];
    for (const m of messages.slice(-20)) {
      if (!m || typeof m !== 'object') continue;
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof m.content === 'string' ? m.content.slice(0, 4000) : '';
      if (!content) continue;
      raw.push({ role, content });
    }
    // Drop leading assistant messages (UI greeting, etc.)
    while (raw.length && raw[0].role !== 'user') raw.shift();
    // Collapse consecutive same-role messages by keeping the latest one
    const cleaned = [];
    for (const m of raw) {
      if (cleaned.length && cleaned[cleaned.length - 1].role === m.role) {
        cleaned[cleaned.length - 1] = m;
      } else {
        cleaned.push(m);
      }
    }
    if (cleaned.length === 0 || cleaned[0].role !== 'user') {
      return res.status(400).json({ error: 'conversation must start with a user message' });
    }

    const system = PORTAL_GUIDE + buildContextBlock(context, new Date());

    const body = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: cleaned,
    };

    const upstream = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      console.error('Anthropic API error:', data);
      return res.status(502).json({
        error: data?.error?.message || 'Upstream AI error',
      });
    }

    // Extract the assistant reply from the content blocks.
    const reply = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return res.status(200).json({ reply, stop_reason: data.stop_reason });
  } catch (err) {
    console.error('AI chat handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
