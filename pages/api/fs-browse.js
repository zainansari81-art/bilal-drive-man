import { supabaseFetch, supabasePost } from '../../lib/supabase';
import { requireAuth, sanitizeString } from '../../lib/auth';

// Live folder listing for the Drives-page Finder browser.
//
// POST { machine_name, drive_label, path } → queues a 'list_directory'
// command for the scanner on that machine, returns { id }. The scanner
// picks it up on its next command poll (~10s), lists the folder, and
// PATCHes the command row with a result JSONB payload.
//
// GET ?id=<uuid> → returns { status, result, error } for that command so
// the browser window can poll until the listing lands.
//
// Requires supabase-migration-fs-browse.sql (result column + widened
// command CHECK constraint). Until it's applied, POST returns 409.

// Reject any path that could escape the drive root before it ever reaches
// a scanner. Scanners re-check with os.path.realpath as defense in depth.
function isSafeRelPath(path) {
  if (path === '') return true;
  if (path.includes('\0') || path.includes('\\')) return false;
  return path.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..');
}

export default requireAuth(async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { machine_name, drive_label, path } = req.body || {};
      if (!machine_name || !drive_label) {
        return res.status(400).json({ error: 'Missing required fields: machine_name, drive_label' });
      }

      const safeMachine = sanitizeString(machine_name);
      const safeDrive = sanitizeString(drive_label);
      const relPath = typeof path === 'string' ? sanitizeString(path, 2048) : '';
      if (!isSafeRelPath(relPath)) {
        return res.status(400).json({ error: 'Invalid path' });
      }

      // Hygiene: browse commands are ephemeral queries, not durable work.
      // Drop stale ones (>1h) so an offline machine coming back doesn't
      // replay a pile of dead listings and the table stays lean.
      try {
        const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        await supabaseFetch(
          `download_commands?command=eq.list_directory&created_at=lt.${encodeURIComponent(cutoff)}`,
          { method: 'DELETE', prefer: 'return=minimal' }
        );
      } catch {
        // best-effort cleanup only
      }

      let result;
      try {
        result = await supabasePost('download_commands', {
          machine_name: safeMachine,
          command: 'list_directory',
          payload: { drive_label: safeDrive, rel_path: relPath },
          status: 'pending',
        });
      } catch (err) {
        // Command CHECK constraint still on the pre-migration value list.
        if ((err.details || err.message || '').includes('download_commands_command_check')) {
          return res.status(409).json({
            error: 'Server not ready — apply supabase-migration-fs-browse.sql in the Supabase SQL Editor first.',
          });
        }
        throw err;
      }

      const row = Array.isArray(result) ? result[0] : result;
      return res.status(201).json({ id: row?.id || null });
    }

    if (req.method === 'GET') {
      const { id } = req.query;
      if (!id || typeof id !== 'string' || !/^[a-f0-9-]+$/i.test(id)) {
        return res.status(400).json({ error: 'Invalid id' });
      }

      const rows = await supabaseFetch(
        `download_commands?id=eq.${id}&select=id,status,result,error_message`
      );
      const row = rows?.[0];
      if (!row) {
        return res.status(404).json({ error: 'Not found' });
      }

      return res.status(200).json({
        status: row.status,
        result: row.result || null,
        error: row.error_message || null,
      });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('FS Browse API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
