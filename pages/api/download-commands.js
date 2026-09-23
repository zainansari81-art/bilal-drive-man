import { supabaseFetch, supabasePost, supabasePatch } from '../../lib/supabase';
import { requireAuth, requireApiKey, sanitizeString } from '../../lib/auth';
import { DOWNLOADING_ENABLED } from '../../lib/features';

async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Protected by requireApiKey - scanner fetches pending commands
      const { machine } = req.query;
      if (!machine) {
        return res.status(400).json({ error: 'Missing required query parameter: machine' });
      }
      // Transfers archived (lib/features.js): skip the DB read. Pre-3.50
      // scanners still poll this every 10s until they auto-update.
      if (!DOWNLOADING_ENABLED) {
        return res.status(200).json([]);
      }

      const commands = await supabaseFetch(
        `download_commands?machine_name=eq.${encodeURIComponent(machine)}&status=eq.pending&order=created_at.asc`
      );
      return res.status(200).json(commands || []);
    }

    if (req.method === 'POST') {
      // Protected by requireAuth - dashboard creates commands
      const { machine_name, command, project_id, payload } = req.body;
      if (!machine_name || !command) {
        return res.status(400).json({ error: 'Missing required fields: machine_name, command' });
      }

      const result = await supabasePost('download_commands', {
        machine_name: sanitizeString(machine_name),
        command: sanitizeString(command),
        project_id: project_id || null,
        payload: payload || null,
        status: 'pending',
      });
      return res.status(201).json(result);
    }

    if (req.method === 'PATCH') {
      // Protected by requireApiKey - scanner updates command status
      const { id, status, error_message } = req.body;
      if (!id || !status) {
        return res.status(400).json({ error: 'Missing required fields: id, status' });
      }

      if (typeof id !== 'string' || !/^[a-f0-9-]+$/i.test(id)) {
        return res.status(400).json({ error: 'Invalid id' });
      }

      const updateBody = {
        status: sanitizeString(status),
      };
      if (error_message) {
        updateBody.error_message = sanitizeString(error_message, 1024);
      }

      // Scanners ignore the response — don't pay egress to echo the row.
      await supabasePatch(`download_commands?id=eq.${id}`, updateBody, { returning: 'minimal' });
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('Download Commands API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Route to different auth middleware based on method
export default async function routeHandler(req, res) {
  if (req.method === 'POST') {
    return requireAuth(handler)(req, res);
  }
  // GET and PATCH are scanner routes, use API key auth
  return requireApiKey(handler)(req, res);
}
