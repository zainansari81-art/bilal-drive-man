import { supabaseFetch, supabasePost, supabasePatch } from '../../lib/supabase';
import { requireAuth, sanitizeString } from '../../lib/auth';

export default requireAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const machines = await supabaseFetch('download_machines?order=machine_name.asc');
      return res.status(200).json(machines || []);
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'update') {
        const { machine_name, dropbox_path, gdrive_path, is_download_pc } = req.body;
        if (!machine_name) return res.status(400).json({ error: 'Missing machine_name' });

        const updateBody = {};
        if (dropbox_path !== undefined) updateBody.dropbox_path = sanitizeString(dropbox_path, 500);
        if (gdrive_path !== undefined) updateBody.gdrive_path = sanitizeString(gdrive_path, 500);
        if (is_download_pc !== undefined) updateBody.is_download_pc = is_download_pc;

        const updated = await supabasePatch(
          `download_machines?machine_name=eq.${encodeURIComponent(machine_name)}`,
          updateBody
        );
        return res.status(200).json(updated);
      }

      if (action === 'register') {
        const { machine_name } = req.body;
        if (!machine_name) return res.status(400).json({ error: 'Missing machine_name' });

        const result = await supabasePost('download_machines', {
          machine_name: sanitizeString(machine_name, 128),
          is_download_pc: true,
          dropbox_path: sanitizeString(req.body.dropbox_path || '', 500),
          gdrive_path: sanitizeString(req.body.gdrive_path || '', 500),
          last_seen: new Date().toISOString(),
        }, 'machine_name');
        return res.status(200).json(result);
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('Machines API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
