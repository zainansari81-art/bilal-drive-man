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

**Use `windows-scanner/build.sh` — always.** Manual `pyinstaller` invocations
broke the deploy twice in one day (3.45.0 hotfix at ~04:30 PKT, 3.47.1 hotfix
at ~20:00 PKT, both 2026-04-25). The wrapper enforces the discipline that
shipping a broken binary requires bypassing — not just remembering.

```
cd windows-scanner
./build.sh        # refuses to run on a dirty tree
```

The script:
1. Refuses to run if `git status --porcelain` is non-empty (forces commit-then-build,
   binary always matches a committed source revision)
2. Nukes `build/`, `__pycache__/`, any `*.spec` files, and stale `dist/*.exe*`
3. Runs `pyinstaller --onefile --windowed --clean --hidden-import=wetransfer_provider`
4. Computes SHA256 of the produced .exe and writes the sidecar (LF endings)
5. Echoes source VERSION + commit + SHA so the human sees what got built

**Override only for development**: `ALLOW_DIRTY=1 ./build.sh` skips the dirty-tree guard.
Production builds must never use that.

After build, commit BOTH `dist/BilalDriveMan-Scanner.exe` and the `.sha256` sidecar
**in the same commit as the source change that bumped VERSION**. Auto-update fetches
both from GitHub raw URLs and verifies the binary matches the sidecar before swapping.

### Pre-merge runtime-verification trap (CRITICAL)

**Never runtime-launch a scanner build whose source VERSION is ahead of main** (e.g. you bumped 3.49.1 → 3.49.2 locally, main is still 3.49.1). The boot-time `auto_update()` peeks remote main, sees local > remote, **downgrades** — downloads main's stale .exe, swaps via the batch shim, exits. Result: `dist/.exe` now contains main's old binary but your sidecar still has the new SHA. Silent corruption.

Verify ahead-of-main builds **statically** instead:
- Use PyInstaller's `CArchiveReader` to extract bundled bytecode from the .exe
- Walk `co_consts` of the `drive_scanner` module to confirm `VERSION = '<new>'`
- Confirm new function names exist in the PYZ
- Confirm new log-string constants are embedded
- This is bulletproof against the stale-`__pycache__` and the auto-update-downgrade traps

After main merges to the new version, runtime-launch is safe (local matches remote, no swap fires).

**Branch-flow for new scanner versions:**
1. Mac edits source, bumps VERSION, commits to a `scanner-X.Y.Z-<feature>` branch
2. Win pulls the branch, runs `./build.sh` (or `ALLOW_DIRTY=1 ./build.sh`), commits + pushes the new `.exe` + `.sha256` to the same branch
3. Mac merges branch → main with `--no-ff` (preserves lineage). Source + .exe + sidecar land together; auto-update on AAHIL sees consistent triple.
4. Mac deletes the dead branch from origin

Never push v(N+1) source to main without a paired v(N+1) `.exe` rebuild — that's the original zombie-loop scenario `build.sh` exists to prevent.

### Auto-update regression test (run after touching build/auto-update code)

We've validated this end-to-end three times today (3.45.0 hotfix, 3.46.0 cycle, 3.47.1
hotfix). The procedure:

1. Bump `VERSION` in `windows-scanner/drive_scanner.py` on a sandbox branch
2. Run `./build.sh` and verify the echoed SHA differs from the prior build
3. Commit + push. Wait for the GitHub raw URL to serve the new file
4. On a Windows PC running the previous version: observe `scanner.log`
5. Within 60s of the next auto-update tick, the log should show:
   ```
   Auto-update: remote vX.Y.Z differs from local vP.Q.R, downloading .exe
   Auto-update: launching shim, exiting to let it replace exe
   Drive monitor started   ← from the relaunched, NEW process
   ```
6. After relaunch, the running process should NOT trigger another `Auto-update:
   remote differs` line on the next tick. If it does — the build was broken
   (stale pyc), kill all processes, run `./build.sh` again, commit a hotfix.

**Failure signature**: every ~60s the log shows `Auto-update: remote ... differs from
local <SAME OLD VERSION>` repeatedly. Zombie scanner processes accumulate. This is
ALWAYS a build-side bug, never a network or auto-update logic bug. The fix is the
hotfix path documented above (and `build.sh` makes it impossible to recur).

### In-process zombie self-defense (v3.51.0+)

Even with `build.sh`, we hit the zombie loop trap **twice** on 2026-04-28 (3.50.0 and
3.50.1 deploys) — Windows kept the old .exe locked while the new file landed on disk,
so old processes kept running their pre-update bytecode. The disk SHA matched main's
SHA, but the running PID was still on the previous VERSION.

**3.51.0 added inline defense in `auto_update()`**: right after fetching the remote
SHA, hash the on-disk .exe. If `local_disk_sha == expected_sha` AND `VERSION !=
remote_ver`, this process is a zombie running stale code from memory. Log RED with
`Auto-update: ZOMBIE SELF-DETECTED` and `sys.exit(0)`. Windows can't re-exec a running
binary in-place, so the safe move is exit and let the OS / scheduled-task / user
respawn from the fresh .exe.

**Don't strip this guard.** It's the last line of defense when the build pipeline,
the shim, and the file-lock semantics all conspire against you. False positives are
impossible (the predicate requires both SHAs equal AND VERSION mismatch — only true
if a zombie). Tail for the literal `ZOMBIE SELF-DETECTED` line in scanner.log if you
suspect a stuck deploy.

**Out-of-process discipline (still applies):** before pushing a new .exe, taskkill
all old PIDs on AAHIL. The in-process guard is a backstop; killing first is the
clean path. CLAUDE.md regression test from above stays the source of truth.

## Wizard-race row-refetch pattern (v3.50.0+)

When the portal wizard queues two commands at the same instant — e.g.
`add_to_cloud` immediately followed by `start_download` — the second command's
*payload* gets captured at enqueue time. If `add_to_cloud` writes a value back to
the project row (like `cloud_folder_path`), `start_download`'s payload still has
the **pre-write** value (empty). If the scanner pulls the second command before
the first's row-write lands, the second handler sees an empty payload and may
incorrectly fall through to legacy logic.

**The pattern** (now in `handle_start_download`): if the payload is missing the
expected field, **re-fetch the project row** from `/api/download-projects?id=X`
before falling through. Use the freshly-backfilled value if it's there. Only if
the row-fetch ALSO comes back empty fall through to the legacy path.

This requires the GET endpoint to support both auth modes (dashboard cookie + scanner
X-API-Key). Use `requireAuthOrApiKey` from `lib/auth.js` (added 2026-04-28 for this
exact reason). New scanner-only endpoints can use plain `requireApiKey`; endpoints
that already serve the dashboard need the dual.

**When you add a future scanner-side feature that depends on a value written by
another command in the same wizard click**, you'll likely need this pattern. Don't
just trust the payload.

## Scanner credentials architecture (v3.49.2+)

OAuth credentials live in **one place**: Vercel env vars. The scanner pulls them via `/api/scanner-credentials` at startup and persists to local `%APPDATA%\BilalDriveMan\config.json`. **Never manually edit the OAuth keys in `config.json`** — they get auto-populated on next launch and any manual edit is overwritten.

- Endpoint: `/api/scanner-credentials` (X-API-Key auth, returns `{dropbox: {refresh_token, app_key, app_secret} | null, google_drive: {refresh_token, client_id, client_secret} | null}`)
- Scanner: `fetch_credentials_from_portal(config)` runs in `main()` after `load_config()`. Force-writes (no `local_v != v` short-circuit — that comparison was unreliable in 3.49.0/3.49.1, see PROJECT_STATE for the chase). Includes post-save verify that re-reads disk and logs ERROR if any field is in memory but not on disk.
- *Adding a new PC:* install scanner with empty `config.json`. On first launch, scanner auto-fetches OAuth keys + persists. No manual edit. Only **paths** (`dropbox_path`, `gdrive_path`) and `is_download_pc` need to be hand-set per PC.
- `dropbox_path` and `gdrive_path` are NOT credentials — they're operator config. Hand-set per machine. Used by `find_cloud_folder()` for the Dropbox shortcut path.

## Cloud Pipeline (Downloading-Pro feature)

Three link types supported: Dropbox + Google Drive + WeTransfer. All three flow
through the wizard's link_type dispatch (DownloadWizardModal.fetchShareStatus →
appropriate /api/*-share-status endpoint).

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

### Google Drive flow (scanner v3.46.0+ — direct download)
- Wizard: `/api/gdrive-share-status` checks if our app's OAuth token can READ the
  share. No popup — if token has access, wizard advances directly. If not, surface
  error about share permissions.
- Scanner: `add_gdrive_shared_folder(token, link, project_id, cancel_evt)` resolves
  folder via `files.get(supportsAllDrives=true)`, recursively lists via
  `files.list(q="'<id>' in parents")` with pageToken loop, downloads each file via
  `files.get(alt=media)` streaming 8MB chunks with Range-resumable retry through a
  ThreadPoolExecutor(6). Google Apps native types (Doc/Sheet/Slide/Drawing) export
  to docx/xlsx/pptx/pdf via `_GDRIVE_EXPORT_MAP`. Files land in
  `%LOCALAPPDATA%\BilalDriveMan\gdrive-staging\<project_id>\` then copy_to_drive
  picks up the staging path as `cloud_folder_path`. Cleanup via `shutil.rmtree`
  after copy success. No Drive desktop client involvement, no quota consumption.
- Idempotency via `.staging-state.json` (atomic .tmp + rename) — crash/reboot
  resume picks up at last completed file, transfer_id+folder_id guard against
  user editing the link mid-job.
- **Known limitation (3.49.2):** GDrive folders with **trailing whitespace** in
  the name (e.g. `"montage reference two "`) cause `os.makedirs` to fail with
  `[Errno 2] No such file or directory` on Windows. Affected files land in
  `.staging-state.json.failed_files` with the path-traversal error. Fix is
  scheduled for 3.50.0: `.rstrip()` each path segment before `os.path.join()`,
  or switch to `pathlib`. Workaround for now: rename the GDrive folder client-
  side OR accept that those files will fail (rest of the share downloads
  fine — partial-failure tracking captures them).

### WeTransfer flow (scanner v3.47.0+ — direct download, per-file)
- Wizard: `/api/wetransfer-share-status` resolves we.tl 302 chain to canonical
  URL, extracts transfer_id + security_hash, calls WeTransfer's
  `/api/v4/transfers/<id>/prepare-download` to confirm reachability + extract
  file_count + total_size_bytes + expires_at. No "join" model — joined=true
  means share is alive + not expired (anonymous public shares, ~7-day TTL).
- Scanner: `add_wetransfer_share(link, project_id, cancel_evt, config)` reuses
  the GDrive 3.46.0 staging primitives. wetransfer_provider.py exposes
  `extract_transfer_ids`, `resolve_short_link`, `prepare_download`,
  `request_file_download_url`, `stream_download` (Range-resumable, mid-download
  direct_link refresh via closure on 403, exp backoff on 429/5xx, cancel-check
  at chunk boundary, size verification). Per-file direct download — NO zip
  (zip route fails mid-transfer for big sets per Zain).
- Files land in `%LOCALAPPDATA%\BilalDriveMan\wetransfer-staging\<project_id>\`,
  copy_to_drive picks up via cloud_folder_path. Cleanup hook checks both gdrive
  + wetransfer staging roots.

### Progress telemetry (scanner v3.46.1+)
- `total_bytes_expected` column on `download_projects` (BIGINT, nullable).
  Scanner emits it once per project right after the listing phase completes
  (gdrive: after `files.list` recursion; wetransfer: after `prepare_download`).
- `phase='gdrive_staging'` (reused for both gdrive + wetransfer staging) is the
  signal that staging is in flight; portal renders progress_bytes /
  total_bytes_expected as the live bar denominator. Falls back to
  `cloud_size_bytes` when total_bytes_expected is NULL (Dropbox path — only
  knows size after pin completes).
- *Migration required:* run
  `ALTER TABLE download_projects ADD COLUMN IF NOT EXISTS total_bytes_expected BIGINT;`
  in Supabase SQL Editor before the column populates. Scanner swallows the 400
  silently if column missing — downloads still work, just no progress telemetry.

### progress_bytes column footgun
- *DO NOT use `download_progress_bytes`* — it's a legacy column that exists in
  Supabase but is never updated by any code path. The live source-of-truth is
  `progress_bytes` (scanner writes via `/api/download-progress.js`).
- The portal card (`components/DownloadingProPage.js`) reads `progress_bytes` first,
  falls back to `download_progress_bytes` only for historical rows. Don't reorder
  or reintroduce `download_progress_bytes` as the primary read.

## WeTransfer code-review-only smoke (scanner v3.47.0)
- The 3.47.0 WeTransfer integration was *not* live E2E-tested. WeTransfer's 2026
  free-tier gating (account/email required, captcha) made scripted upload from a
  CLI session infeasible without browser automation we deemed too costly.
- Code is integration-tested via `python3 -m py_compile` + `npm run build` only.
- *First production WeTransfer download is the de-facto smoke test.* Watchpoints
  to monitor on first real client share:
  1. `_wt.resolve_short_link` 302 chain — most likely break vector if WeTransfer
     adds bot detection on HEAD requests
  2. `prepare_download` 403/404 on expired or quota-blocked shares
  3. mid-stream `direct_link` refresh on 403 — closure-based, not network-tested
- If the first real download fails, project is cancelable cleanly (cooperative
  cancel-event wired through staging loop), so the failure is contained.

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
- `/api/download-projects` — list, plus actions (download_now, resume, cancel, remove, etc.)
  - `remove` action sends `cancel_download` to scanner BEFORE deleting the row (so scanner
    stops staging) AND syncs Notion to 'idle' (so the next notion-sync doesn't re-create
    the project with stale 'Downloading' status). Without this, removing a mid-download
    project orphans the scanner thread + leaves Notion stale. Don't strip the cancel
    or sync.
- `/api/notion-sync` — pull from Notion → upsert download_projects
- `/api/dropbox-share-status` — wizard check before download_now
- `/api/gdrive-share-status` — same for Drive shares
- `/api/wetransfer-share-status` — same for WeTransfer shares. Accepts EITHER
  `?project_id=<uuid>` (normal flow) OR `?url=<wetransfer-link>` (ad-hoc QA mode for
  validating an arbitrary we.tl link without creating a Notion card first)
- `/api/cloud-accounts` — list of available Dropbox/GDrive accounts (Gap 1)

## Diagnostic discipline on Windows (AAHIL)

**Reading `config.json` to verify on-disk content:** use `cat path | python -c "..."`, **NOT** `python -c "open(path).read()"`. The latter has a Git-Bash + Python read-caching quirk on AAHIL that returns stale content even after fresh writes — caused us a 3-hour debugging chase in the 3.49.0 → 3.49.1 → 3.49.2 cycle (we thought scanner wasn't persisting credentials, when in fact disk was correct and the verification tool was lying). Always pipe through `cat` for live reads.

**Heartbeat upsert footgun:** `pages/api/heartbeat.js` line 48 only calls `supabasePost('download_machines', …)` if `is_download_pc || dropbox_path || gdrive_path` is truthy. If all three are falsy in a heartbeat payload (e.g. scanner has empty config), the upsert is skipped entirely. *That means `download_machines.dropbox_path` in Supabase can show stale values that no longer reflect the live scanner config.* Don't trust the DB row as authoritative for live config — query the running scanner's heartbeat payload directly if you need ground truth.

**Network-isolated scanner is still useful:** `googleapis.com`, `api.dropboxapi.com`, etc. resolve via separate DNS paths from `bilal-drive-man.vercel.app`. AAHIL can be portal-isolated (heartbeats failing, command poll dead) while still actively downloading from cloud APIs. When heartbeat is stale, **check `.staging-state.json.bytes_done` mtime** before assuming the download is dead — bytes may still be flowing locally.

## Critical CSS Note (page-transition)

`.page-transition` uses an opacity-only animation (no transform). DO NOT add a
`transform: ...` rule to this class — even an identity transform creates a containing
block for descendants and breaks `position: fixed` on modal overlays
(DownloadWizardModal, DownloadMagicAnimation). Was a real bug we already fixed.

## Two-Claude Coordination (consolidated 2026-04-26)

Per Zain's consolidation directive: **mac-Claude (this Claude) owns all dev work.** Win-Claude is testing-only on AAHIL.

- *Mac (me)*: all code (portal, scanner Python, mac-scanner), all git operations, all architecture decisions, all docs (CLAUDE.md + PROJECT_STATE.md), all Supabase queries, all OAuth/Vercel work, all build cycles. Never auto-commit without explicit user greenlight.
- *Win (AAHIL)*: live testing only — fires test downloads on operator command, tails `scanner.log`, runs `tasklist | findstr BilalDriveMan` for liveness checks, edits `config.json` paths (`dropbox_path`/`gdrive_path` only — never OAuth keys). Reports observations back via Slack; mac writes them into PROJECT_STATE.

Coordination via Slack `#claude-coord` (channel ID `C0AUX615GQK`) using `[mac]` / `[win]` prefix.

**Build cycle for scanner changes** (since mac can't build Windows .exe):
1. Mac commits source change to a `scanner-X.Y.Z-<feature>` branch (NEVER push directly to main without paired .exe)
2. Win pulls branch, runs `./build.sh` (or `ALLOW_DIRTY=1 ./build.sh`), commits + pushes new `.exe` + `.sha256` to same branch
3. Mac merges branch → main with `--no-ff`, deletes branch from origin

**Idle-update obligation:** if either side is idle for >30 min, post `[mac/win] idle, available for tasks` in #claude-coord.

**Email escalation rule:** if a side goes silent for 30 consecutive minutes when the other is waiting on output, the other side emails Zain at `zainansari0340@gmail.com` (from his logged-in `zainansari81@gmail.com` Gmail). Don't sit on a blocker.

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
- **`.staging-state.json` dict hygiene**: when you add a state dict that tracks failures (`failed_files`, `failed_X`, etc.), also `dict.pop(key, None)` from it on retry-success. Otherwise the final tally over-counts failures (we shipped a misleading "12 ok, 3 failed" line in 3.50.0 because trailing-whitespace files succeeded on retry but stayed in `failed_files` — fixed in 3.51.0).
- **Targeted Notion card cloning for E2E tests**: when running fresh E2E tests, append a suffix to a Notion card name (`(test-N)` or a date) so the wizard treats it as a new project. Don't reuse the same project across runs — the staging dir, completed_at timestamp, and progress_bytes from the prior run can mask new failures.
- **All scanner code paths that wait + fail with a generic error** should distinguish failure modes via a one-shot cloud-side metadata probe (Dropbox: `/2/files/get_metadata`; GDrive: equivalent). The default error wording must point operators at the right system. Pattern documented in `dropbox_check_cloud_path_exists` (drive_scanner.py).
