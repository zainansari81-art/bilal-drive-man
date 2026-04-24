# Bilal Drive Man — Project Context

## Tech Stack
- Framework: Next.js (Pages Router) with getServerSideProps for SSR
- Language: JavaScript (no TypeScript)
- Styling: Plain CSS in styles/globals.css — no Tailwind, no CSS modules
- Database: Supabase PostgreSQL via REST API (lib/supabase.js)
- Auth: bcrypt + HMAC session tokens (lib/auth.js)
- Deployment: Vercel (auto-deploys from GitHub main branch)
- Scanners: Python scripts on Mac (LaunchAgent) and Windows (system tray, packaged as PyInstaller .exe)

## Folder Structure
- /pages           Next.js pages and API routes
- /pages/api       All backend endpoints
- /components      React components (one per page: DrivesPage, DevicesPage, etc.)
- /lib             Shared utilities (supabase.js, auth.js, format.js)
- /styles          globals.css — single CSS file for all styling
- /mac-scanner     Mac scanner Python script (synced to GitHub for auto-update)
- /windows-scanner Windows scanner Python script + dist/BilalDriveMan-Scanner.exe + .sha256 sidecar

## Build Commands
- `npm run dev`    Start dev server on port 3000
- `npm run build`  Production build (verify before pushing)

## Key Patterns
- All Supabase queries go through lib/supabase.js — never hardcode keys elsewhere
- API routes use requireAuth (dashboard, session cookie) or requireApiKey (scanner endpoints, x-api-key header)
- Accent color: #c8e600 (green), Dark: #1a1a2e, Background: #f4f5f7
- CSS class naming: page-prefix pattern (dp- for downloading-pro, device- for devices)
- Responsive breakpoints: 480px, 768px, 1024px, 1200px, 1440px, 1920px

## Scanner Files — IMPORTANT
- After editing scanner Python files, MUST copy to BOTH locations:
  - Working copy: /mac-scanner/ or /windows-scanner/ (outside web-app)
  - Git repo: web-app/mac-scanner/ or web-app/windows-scanner/
- Bump VERSION string when changing scanner code
- Mac scanner auto-updates from GitHub raw URL every 5min
- Windows scanner uses a PyInstaller-aware batch-shim auto-update (see "Windows Scanner Build" below)

## Windows Scanner Build (PyInstaller .exe)

**Critical: ALWAYS use `--clean` and wipe `build/` + `__pycache__/` before rebuilding.**
Stale `__pycache__/drive_scanner.cpython-*.pyc` from a previous source version will get
re-bundled and the resulting .exe will self-report the OLD VERSION string. That breaks
auto-update (binary downloads new .exe but reports old version → infinite loop).

```
cd windows-scanner
rm -rf build/ __pycache__/
pyinstaller --onefile --windowed --clean --name BilalDriveMan-Scanner drive_scanner.py
shasum -a 256 dist/BilalDriveMan-Scanner.exe | awk '{print $1}' > dist/BilalDriveMan-Scanner.exe.sha256
```

After rebuild, commit BOTH the .exe and the .sha256 sidecar. The auto-update mechanism
fetches both from GitHub raw URLs and verifies the binary matches the sidecar before
swapping.

## Cloud Pipeline (Downloading-Pro feature)

Two link types fully supported: Dropbox + Google Drive. WeTransfer is intentionally
blocked at the API layer (returns `WETRANSFER_NOT_IMPLEMENTED`).

### Dropbox flow
1. Notion sync detects `dropbox.com` URL → `link_type=dropbox`
2. Wizard checks `/api/dropbox-share-status` — if `joined: false`, shows popup with
   "Open Dropbox" button (Dropbox API has no programmatic "Add to my Dropbox", so user
   must click manually in the popup)
3. Portal polls every 3s, advances when share appears in Rafay's Dropbox
4. Scanner `add_to_cloud` uses Dropbox API mount_folder OR soft-success for scl shares
   already in user's namespace
5. Scanner persists `cloud_folder_path` (e.g. `C:\Users\txbla\Dropbox\<folder>`) on
   download_projects + backfills the start_download command's payload
6. Scanner `start_download` reads payload's cloud_folder_path, waits up to 90s polling
   `os.path.isdir()` for Dropbox desktop sync to materialize folder locally
7. Scanner pins files offline via `pin_file_offline` — tries SetFileAttributesW
   (legacy Dropbox), falls back to 1-byte read (forces Cloud Files Provider hydration
   on modern Dropbox/OneDrive/iCloud)
8. After all files materialize, scanner copies to `<target_drive>:\<client>\<couple>\<files>\`

### Google Drive flow
- Same wizard pattern, but `/api/gdrive-share-status` checks if our app's OAuth token
  can READ the share (Google Drive API). No popup needed — if our token has access,
  wizard advances directly. If not, surface error about share permissions.
- Scanner currently uses old shortcut-API path (creates Drive shortcut, syncs via
  Drive desktop client). Refactor to direct-download via Drive API is in flight
  (option D — uses files.get(alt=media) to download files directly to a staging
  folder, no Drive desktop dependency).

### Drive folder structure
Files always land at `<target_drive>:\<client_name>\<couple_name>\<files>` on the
external drive. If `<client_name>` folder already exists, reuse + create couple
subfolder inside. If not, create both.

## Env Vars (Vercel production)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`
- `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `AUTH_SECRET`
- `SYNC_API_KEY` (scanner x-api-key)
- `NOTION_API_KEY`, `NOTION_DATABASE_ID`
- `DROPBOX_REFRESH_TOKEN`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`
  (BilalDriveMan Dropbox app, used by `/api/dropbox-share-status`)
- `GDRIVE_REFRESH_TOKEN`, `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`
  (BilalDriveMan Google Cloud project `impressive-mile-402907`, OAuth app authorized
  by photographybyrafay@gmail.com — used by `/api/gdrive-share-status` and the future
  scanner direct-download path)

NEVER strip env values with literal `\n` trailing — Vercel UI sometimes inserts these.
Pull via `vercel env pull --environment=production` and grep for `\\n"` to detect.

## Endpoint Conventions

- `requireAuth` (dashboard): session cookie auth
- `requireApiKey` (scanner-only): X-API-Key header
- All API errors return generic messages — never expose err.message to client
- Sanitize all string inputs with sanitizeString from lib/auth.js
- Filter out temp volumes (msu-target-*, fcpx-*) in both scanner and dashboard
- Login rate limiting is DISABLED per user request — do not re-enable

### Notable scanner-auth endpoints
- `/api/heartbeat` — scanner liveness
- `/api/sync` — drive scan results
- `/api/download-commands` — scanner polls for pending commands (filters by machine + status=pending)
- `/api/download-progress` — scanner reports phase/progress + persists cloud_folder_path
- `/api/scanner-resume-check` — scanner asks "what should I resume on boot?" (returns orphaned downloading projects + counts resume_attempts)
- `/api/scanner-reset-stale-acked` — scanner boot recovery: PATCH acked-but-stale commands back to pending (atomic, server-clock cutoff)

### Notable dashboard-auth endpoints
- `/api/download-projects` — list, plus actions (download_now, resume, cancel, etc.)
- `/api/notion-sync` — pull from Notion → upsert download_projects
- `/api/dropbox-share-status` — wizard check before download_now
- `/api/gdrive-share-status` — same for Drive shares
- `/api/cloud-accounts` — list of available Dropbox/GDrive accounts (Gap 1)

## Critical CSS Note (page-transition)

`.page-transition` uses an opacity-only animation (no transform). DO NOT add a
`transform: ...` rule to this class — even an identity transform creates a containing
block for descendants and breaks `position: fixed` on modal overlays
(DownloadWizardModal, DownloadMagicAnimation). Was a real bug we already fixed.

## Two-Claude Coordination

This project is worked by two Claude instances simultaneously:
- *Mac Claude*: handles portal (Next.js + Vercel), web UI, OAuth setup via browser,
  Mac-side scanner (when added), all deployments to local Mac filesystem + GitHub main
- *Windows Claude*: handles Windows scanner code on AAHIL PC, builds the .exe, deploys
  to AAHIL specifically, runs E2E tests on the Windows side

They coordinate via Slack `#claude-coord` (channel ID `C0AUX615GQK`) using `[mac]` /
`[win]` prefix. *Deployments are split:* Mac handles Mac/local + GitHub merges, Win
handles AAHIL .exe deployments. Each side respects the other's territory.

## Conventions
- NEVER expose Supabase keys in client-side code
- NEVER remove the hardcoded fallback key in lib/supabase.js
- All API errors return generic messages — never expose err.message to client
- Sanitize all string inputs with sanitizeString from lib/auth.js
- Filter out temp volumes (msu-target-*, fcpx-*) in both scanner and dashboard
- Login rate limiting is DISABLED per user request — do not re-enable
- Never auto-commit without explicit user confirmation
- Always include Co-Authored-By line when committing
- Verify `npm run build` passes before pushing
- For scanner changes, bump VERSION + rebuild .exe with `--clean`
