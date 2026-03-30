import { supabaseFetch } from '../../lib/supabase';
import { requireAuth, sanitizeString } from '../../lib/auth';

export default requireAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const accounts = await supabaseFetch('cloud_accounts?order=created_at.asc');
      return res.status(200).json(accounts || []);
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'create') {
        const accountName = sanitizeString(req.body.account_name || '', 200);
        const accountType = req.body.account_type;
        const email = sanitizeString(req.body.email || '', 200);
        const localSyncPath = sanitizeString(req.body.local_sync_path || '', 500);

        if (!accountName || !accountType) {
          return res.status(400).json({ error: 'Account name and type are required' });
        }
        if (!['dropbox', 'google_drive'].includes(accountType)) {
          return res.status(400).json({ error: 'Invalid account type' });
        }

        const result = await supabaseFetch('cloud_accounts', {
          method: 'POST',
          body: {
            account_name: accountName,
            account_type: accountType,
            email: email || null,
            local_sync_path: localSyncPath || null,
            is_active: true,
          },
        });
        return res.status(200).json(result);
      }

      if (action === 'update') {
        const { id, ...updates } = req.body;
        if (!id) return res.status(400).json({ error: 'Account ID required' });

        const body = {};
        if (updates.account_name) body.account_name = sanitizeString(updates.account_name, 200);
        if (updates.email) body.email = sanitizeString(updates.email, 200);
        if (updates.local_sync_path !== undefined) body.local_sync_path = sanitizeString(updates.local_sync_path || '', 500);
        if (updates.is_active !== undefined) body.is_active = updates.is_active;

        const result = await supabaseFetch(`cloud_accounts?id=eq.${id}`, {
          method: 'PATCH',
          body,
        });
        return res.status(200).json(result);
      }

      if (action === 'delete') {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Account ID required' });

        await supabaseFetch(`cloud_accounts?id=eq.${id}`, { method: 'DELETE' });
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('Cloud accounts API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
