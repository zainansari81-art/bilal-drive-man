/**
 * Picks the right Dropbox OAuth credentials based on which scanner machine
 * the project / scanner belongs to.
 *
 * Background: Bilal has more than one Dropbox account in play. PC1
 * (DOWNLOADING-PRO) uses the original BilalDriveMan app. PC2 (DOWNLOADINGPC2)
 * uses a second Dropbox app on a different account
 * (DROPBOX_ACCOUNT_2_EMAIL — set per-deploy in Vercel). Every scanner /
 * portal-side Dropbox API call must route to the matching account or the
 * "joined" check, mount, save_url, etc. will see the WRONG Dropbox tree
 * and return false negatives / false positives.
 *
 * Returns null only if the requested account's env vars aren't fully
 * populated — caller decides how to handle (current callers treat null
 * as "not configured" and surface a 500).
 *
 * @param {string|null|undefined} machineName  The scanner machine name.
 *   - Case-insensitive match.
 *   - Anything that isn't an explicit "account 2" machine falls back to
 *     account #1 — keeping PC1 + every existing scanner behaving exactly
 *     as before this routing change shipped.
 * @returns {{refresh_token, app_key, app_secret, email, account_index}|null}
 */
export function getDropboxAccountForMachine(machineName) {
  const normalized = (machineName || '').toString().trim().toUpperCase();

  // List of machines that route to account #2. Add new machines here as
  // they're wired up. Kept as a constant rather than an env var because
  // (a) we want code review when this list changes, and (b) it's a tiny
  // list — under a dozen entries even at full org scale.
  const ACCOUNT_2_MACHINES = ['DOWNLOADINGPC2'];

  if (
    ACCOUNT_2_MACHINES.includes(normalized) &&
    process.env.DROPBOX_REFRESH_TOKEN_2 &&
    process.env.DROPBOX_APP_KEY_2 &&
    process.env.DROPBOX_APP_SECRET_2
  ) {
    return {
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN_2,
      app_key: process.env.DROPBOX_APP_KEY_2,
      app_secret: process.env.DROPBOX_APP_SECRET_2,
      email: process.env.DROPBOX_ACCOUNT_2_EMAIL || null,
      account_index: 2,
    };
  }

  if (
    process.env.DROPBOX_REFRESH_TOKEN &&
    process.env.DROPBOX_APP_KEY &&
    process.env.DROPBOX_APP_SECRET
  ) {
    return {
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      app_key: process.env.DROPBOX_APP_KEY,
      app_secret: process.env.DROPBOX_APP_SECRET,
      email: process.env.DROPBOX_ACCOUNT_EMAIL || null,
      account_index: 1,
    };
  }

  return null;
}
