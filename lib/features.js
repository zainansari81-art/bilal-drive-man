// Feature switches.
//
// The Transfers (Downloading-Pro) section is ARCHIVED as of 2026-09-23:
// Zain only uses drive management. Archived means the Transfers page and the
// Machines page's download-PC details are hidden, their polling (projects,
// Notion sync, cloud accounts, live progress, /api/machines) no longer runs,
// and scanners get an empty command list without a database read. All code,
// API routes and Supabase tables are kept intact — set this to true and
// redeploy to bring the whole section back.
export const DOWNLOADING_ENABLED = false;
