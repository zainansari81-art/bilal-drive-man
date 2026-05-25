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
- /components      React components — page components (DashboardPage, DrivesPage, DevicesPage, DownloadingProPage, SearchPage, HistoryPage), shell (Sidebar=Rail, Header=StatusStrip), shared primitives (atoms.js: LED/Gauge/Spool/Fuel/Runway/etc., CountUp.js)
- /pages/_document.js  Document — font <link>s live HERE, not in next/head (see SSR footguns)
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
the shim, and the file-lock semantics all conspire against you. The predicate
requires BOTH SHAs equal AND VERSION mismatch — true in two scenarios:
1. **Genuine zombie:** old process running in memory after a successful disk-side
   update. (intended target)
2. **False positive — source VERSION ahead of binary on main:** someone bumped
   `VERSION = '3.X.Y'` in `drive_scanner.py`, committed it, but never rebuilt and
   committed the paired .exe. Every running scanner pulls remote_ver = '3.X.Y',
   compares to its in-memory `VERSION = '3.(X-1).Y'`, hashes on-disk .exe (which
   is the OLD .exe, hence its SHA matches the OLD .exe's expected_sha because
   the .sha256 sidecar was never updated either), and self-kills. Task Scheduler
   restarts it. Cycle repeats every ~5 min until source VERSION is corrected
   OR a fresh paired .exe lands. We hit this 2026-05-04 — VERSION had been
   bumped 3.51.0 → 3.53.0 for `live_progress` work but no .exe rebuild ever
   landed in `dist/`. Fix was reverting the VERSION constant to 3.51.0 to match
   the shipped binary (commit `17037f7`).

**Out-of-process discipline (still applies):** before pushing a new .exe, taskkill
all old PIDs on AAHIL. The in-process guard is a backstop; killing first is the
clean path. CLAUDE.md regression test from above stays the source of truth.

### Atomic VERSION bump rule (v3.51.0 lessons)

**A scanner VERSION constant bump in `drive_scanner.py` and the paired .exe
rebuild MUST land in the SAME git commit.** Any commit that touches the line
`VERSION = '...'` without also touching `windows-scanner/dist/BilalDriveMan-Scanner.exe`
+ `windows-scanner/dist/BilalDriveMan-Scanner.exe.sha256` is a production
landmine — every downstream scanner self-kills on the next auto-update tick
via the false-positive path documented above.

**Pre-push verification command** (run this before every `git push origin main`
that touches `drive_scanner.py`):

```bash
# In web-app root. Should print nothing (silent = safe).
SOURCE_VER=$(grep -m1 "^VERSION = " windows-scanner/drive_scanner.py | sed "s/.*'\(.*\)'.*/\1/")
EXE_SHA_FILE=$(cat windows-scanner/dist/BilalDriveMan-Scanner.exe.sha256 | tr -d '\n')
EXE_SHA_REAL=$(shasum -a 256 windows-scanner/dist/BilalDriveMan-Scanner.exe | awk '{print $1}')
[ "$EXE_SHA_FILE" != "$EXE_SHA_REAL" ] && echo "MISMATCH: .sha256 sidecar does not match actual .exe SHA"
git log -1 --name-only --format="" | grep -q "drive_scanner.py" && \
  ! git log -1 --name-only --format="" | grep -q "BilalDriveMan-Scanner.exe$" && \
  echo "DANGER: drive_scanner.py changed without paired .exe rebuild in this commit"
```

Two checks:
- `.exe.sha256` sidecar matches the actual `.exe` hash on disk (file integrity)
- If the last commit changed `drive_scanner.py`, it MUST also include
  `windows-scanner/dist/BilalDriveMan-Scanner.exe` (atomic-bump enforcement)

**Mac-Claude can't build the .exe.** When mac-side wants to ship a feature that
bumps VERSION, the workflow is:
1. Mac creates a `scanner-X.Y.Z-<feature>` branch with the source change AND
   bumped VERSION constant.
2. Push branch — DO NOT MERGE TO MAIN YET.
3. A Windows machine with PyInstaller (AAHIL or one of the downloading PCs)
   pulls the branch, runs `./windows-scanner/build.sh`, commits the resulting
   `dist/BilalDriveMan-Scanner.exe` + `.exe.sha256` to the SAME branch, pushes.
4. Mac merges the branch to main with `--no-ff` only after both source AND
   binary are present in the branch tip.
5. Auto-update propagates. Run the pre-push verification command above one
   last time before the merge for safety.

**If main ever ends up with source VERSION > binary VERSION again** (shouldn't
happen with the above discipline, but if):
- Symptom: every scanner instance dies within ~5 min of launch with `LastTaskResult: 0`.
- Quick fix: revert VERSION constant on main back to whatever the .exe was built from.
- Proper fix: rebuild the .exe at the higher version + commit it as a paired
  bump immediately after.

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
- **Trailing-whitespace fix (3.50.0+):** Each path segment is `.rstrip(' .')`'d
  before `os.path.join()` inside `_download_task` — strips trailing spaces AND
  trailing dots (Windows reserves both as illegal terminal chars in path
  components). Verified end-to-end on 2026-04-28's arfoglow run: the
  `montage reference two ` folder + its 3 files (including
  `ref 2 copy (old v).mp4`) now copy cleanly to D:. Note this only handles
  *trailing* whitespace — leading whitespace (e.g. `" montage ref 1 our version.mp4"`)
  is preserved and works fine on Windows.
- **Failed-files retry-success cleanup (3.51.0+):** When a previously-failed
  file succeeds on retry, scanner now `failed.pop(fid, None)`'s its entry from
  `.staging-state.json.failed_files` in both gdrive + wetransfer download
  loops. Pre-3.51.0 bug: `"12 ok, 3 failed"` tally lied because the dict still
  held the originally-failed IDs. Verified 22:33:54 PKT on 2026-04-28:
  `"1 files ok, 0 failed"` — clean tally even after wedge-recovery scenario.

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

**Post-network-gap recovery is slow — don't kill prematurely.** After a long DNS outage (we saw a 5h gap on 2026-04-28 17:29 → 22:22 PKT), the scanner's cached OAuth tokens go stale and pending HTTP sockets to `googleapis.com` may hang on `socket.recv()` (urllib3 has no default timeout). When network returns, the next `add_to_cloud` will:
1. Refresh the OAuth token (logs `Refreshed Google Drive access token`)
2. Retry the in-flight call (logs `Retrying google_drive call after token refresh`)
3. **Then go silent for 4–7 minutes** while the retry chain unwedges and the listing completes — log mtime appears stuck, drive-monitor heartbeat (normally every ~12s) also goes silent because the GIL is held by the gdrive thread.

This is **NOT a wedge** — it's the OAuth+listing recovery path being slow. Verified 2026-04-28: scanner went silent 22:27:07 → 22:33:54 (6m47s), then completed the full happy path cleanly (download → pin → copy → cleanup). Don't kill+relaunch unless silence exceeds ~10 min AND CPU% stays at 0 AND memory is flat (no oscillation).

Diagnostic ladder before declaring wedge:
1. `tasklist /FI "IMAGENAME eq BilalDriveMan-Scanner.exe"` — both PIDs alive?
2. Memory drift over 30s — oscillating (44M ↔ 61M) = working; flat = wedged
3. `ping bilal-drive-man.vercel.app` — network actually up?
4. `Get-Counter "\Process(BilalDriveMan-Scanner*)\% Processor Time"` over 3 samples — bursty even at low % = working; sustained 0% = I/O-blocked
5. Wait at least 8–10 min from the last log line before kill — token refresh chains genuinely take that long.

## Critical CSS Note (page-transition)

`.page-transition` uses an opacity-only animation (no transform). DO NOT add a
`transform: ...` rule to this class — even an identity transform creates a containing
block for descendants and breaks `position: fixed` on modal overlays
(DownloadWizardModal, DownloadMagicAnimation). Was a real bug we already fixed.

## UI Redesign & SSR footguns (2026-05-18 — "console" redesign shipped, commit d774b74)

The portal UI is the minimal "console" redesign as of 2026-05-18. All 6 pages
restyled; `globals.css` replaced wholesale; Geist Sans/Mono from Google Fonts;
shared primitives in `components/atoms.js`; animated counter in `CountUp.js`.
The redesign was frontend-only — `pages/api/*` and `lib/*` were untouched.

Three footguns learned shipping it — DO NOT regress these:

1. **Font `<link rel="stylesheet">` MUST go in `pages/_document.js`, never in
   `next/head`** (`_app.js` or a page's `<Head>`). A stylesheet added via
   next/head makes Next.js inject `<style>body{display:none}</style>` as a FOUC
   guard that only clears once the sheet loads. If the font CDN is slow or
   unreachable the whole app white-screens — and `display:none` on `body` also
   freezes every CSS animation. This caused a full white-screen on 2026-05-18.

2. **Never render `new Date()`, `Date.now()`, `Math.random()`, or any
   time/locale-dependent value during SSR render.** The server value and the
   first client render differ → React hydration mismatch → hydration aborts
   ("Text content does not match server-rendered HTML"). Pattern: start the
   state `null`, populate it in `useEffect` (client-only), render a placeholder
   until then. `ClockTime` in `Header.js` is the reference implementation.

3. **The `.fade-in` page wrapper must stay visible without its animation.** A
   page-level opacity animation is a single point of failure for a blank page —
   if it ever stalls at frame 0 the whole page is invisible. `.fade-in` is now
   `animation: none; opacity: 1`; per-list `.stagger` animations provide entry
   motion instead.

4. **The redesign port wholesale-replaced `globals.css` and silently dropped CSS
   classes still referenced in JSX.** Found 2026-05-23 — clicking Download did
   "nothing" because `.delete-modal-overlay` (used by `DownloadWizardModal`,
   `DeleteConfirmModal`, `DownloadMagicAnimation`) had no rules, so the modal
   rendered as a normal block at the bottom of the document flow (~y:30,823px
   below the viewport). The user never saw it. Same class of bug bit the
   `.magic-anim-*` keyframes — the download-fired animation never ran
   `onAnimationEnd`, so the overlay stuck on screen until refresh. Restored
   rules in `040828d`; added a safety `setTimeout` fallback for
   `DownloadMagicAnimation.onDone` in `fb80de9`. **Audit rule**: when porting
   a stylesheet wholesale, `grep -r 'className="<class>"' components/ pages/`
   for every class used in JSX and confirm each one has rules in the new CSS.

## Dropbox wizard regression — joined-status check (2026-05-23, commits 2995209, 0134c7d)

Two separate bugs in the same flow shipped today; both made the wizard skip
the "Add to Dropbox" step and silently fire `download_now` for folders that
weren't actually in Rafay's Dropbox, leading to scanner failures at the
`pinning` / `add_to_cloud` step.

1. **Server side (`pages/api/dropbox-share-status.js`)**: a share's
   `shared_folder_id` being present in the link metadata only means the share
   is *mountable*, NOT mounted in the account. The old code treated any
   `shared_folder_id` as `joined: true`. Fix: when `shared_folder_id` is set,
   verify mount via `sharing/get_folder_metadata` → only `joined: true` if the
   response has `path_lower` (i.e. the folder really lives in the user's tree).

2. **Client side (`components/DownloadingProPage.js: handleDownloadClick`)**:
   the wizard only opened when machine OR drive was missing. For Dropbox
   projects where machine + drive were both already set but the folder still
   wasn't in the account, the click fired `download_now` directly, bypassing
   the Add-to-Dropbox step. Fix: for `link_type === 'dropbox'`, fetch
   `dropbox-share-status` synchronously on click and route to the wizard
   whenever `joined: false`, regardless of machine/drive state.

**Invariant for any future Download-trigger path**: a Dropbox project must
never enter `download_now` with `joined: false`. If you add a new way to
fire a download (button, action, bulk operation, etc.), guard it with the
same share-status check.

## .env.local footgun — `$` in values

Next.js loads `.env.local` through dotenv-expand, which treats `$NAME` as a
variable reference. Values containing `$` — notably the bcrypt
`AUTH_PASSWORD_HASH` (`$2b$12$...`) — get mangled (`$2b`, `$12` expand to empty)
so local-dev login silently fails with 401. **Escape every `$` as `\$`** in
`.env.local`. Production is unaffected — Vercel stores env-var values literally,
no dotenv parsing.

## Two-Claude Coordination (consolidated 2026-04-26)

Per Zain's consolidation directive: **mac-Claude (this Claude) owns all dev work.** Win-Claude is testing-only on AAHIL.

- *Mac (me)*: all code (portal, scanner Python, mac-scanner), all git operations, all architecture decisions, all docs (CLAUDE.md + PROJECT_STATE.md), all Supabase queries, all OAuth/Vercel work, all build cycles. Never auto-commit without explicit user greenlight.
- *Win (AAHIL)*: live testing only — fires test downloads on operator command, tails `scanner.log`, runs `tasklist | findstr BilalDriveMan` for liveness checks, edits `config.json` paths (`dropbox_path`/`gdrive_path` only — never OAuth keys). Reports observations back via Slack; mac writes them into PROJECT_STATE.

Coordination via Slack `#claude-coord` (channel ID `C0AUX615GQK`) using `[mac]` / `[win]` prefix.

**Build cycle for scanner changes (2026-05-25 update — prefer GitHub Actions):**
The GitHub Actions workflow (`.github/workflows/build-windows-scanner.yml`)
is now the canonical Windows-build path. Trigger via the Actions tab with
an optional `target_version` input; the workflow bumps VERSION, runs
PyInstaller on a windows-latest runner, and commits the .exe + .sha256
sidecar back to main in one atomic commit. No Windows PC needed.

Legacy path (when GitHub Actions is unavailable, e.g. runner outage):
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
- **Long-running scanner commands MUST be threaded.** The command dispatcher runs handlers either synchronously on the poll loop or in a background `threading.Thread`. Any handler that can take more than a few seconds MUST be threaded — a synchronous long handler freezes the *entire* scanner: no heartbeat (portal shows the PC offline), no drive scanning, no other commands, no log output. `add_to_cloud` was synchronous through 3.51.0 — fine for Dropbox (quick mount) but catastrophic for Google Drive, where `add_to_cloud` does the full recursive listing + file download (hours). Fixed in 3.52.0 (`scanner-3.52.0-add-to-cloud-threading` branch): `add_to_cloud` now runs via `_safe_run_command` in a daemon thread like `start_download`/`copy_to_drive`.
- **Operator note — a download stuck in `downloading` status can't be re-fired.** The portal only shows the **Download** button (which opens the wizard / the Dropbox "Add to my Dropbox" step) on **idle** projects. A project frozen in `downloading` shows Pause/Cancel instead, so the wizard can't be re-triggered. To recover a stuck download: **Cancel it first** (→ idle), then Download again.
- **Font links → `pages/_document.js` only.** Never add `<link rel="stylesheet">` via `next/head` — triggers Next's `body{display:none}` FOUC guard that white-screens the app if the CDN is slow. (See "UI Redesign & SSR footguns".)
- **No time/random values in SSR render.** `new Date()`/`Date.now()`/`Math.random()` during render → hydration mismatch. Start state `null`, set in `useEffect`.
- **`.env.local` `$`-escaping.** Escape every `$` as `\$` in `.env.local` values (bcrypt hashes etc.) — dotenv-expand mangles unescaped `$`.
- **Dropbox shared-folder "(1)" suffix.** When a folder is re-added to Dropbox and one of that name already exists, Dropbox appends ` (1)`/` (2)`. `dropbox-share-status.js` detection probes the base name + numbered variants; the operator-facing fix is to rename the folder to drop the suffix so the scanner's exact-path `cloud_folder_path` resolves.

## Multi-Dropbox-account routing (2026-05-24, v3.54.0+)

Bilal has more than one Dropbox account in play. PC1 (DOWNLOADING-PRO) uses
the original BilalDriveMan app on Bilal's main Dropbox. PC2 (DOWNLOADINGPC2)
uses a second Dropbox app on a different account (`filmsbyrafay@gmail.com`).
The routing has to live on BOTH the portal side (so share-status/add-to-Dropbox
hit the right account) AND the scanner side (so it pulls the right creds).

**Architecture — single source of truth: `lib/dropboxAccount.js`.**
`getDropboxAccountForMachine(machineName)` is the only thing that decides
which account a machine uses. Add a new machine to the `ACCOUNT_2_MACHINES`
const inside it; no other code changes needed. **Never duplicate this
mapping anywhere else** — every consumer (share-status, scanner-credentials,
future flows) must go through this helper.

Env vars on Vercel (per-account, additive — don't touch the account-1 vars
that already work):
- Account 1 (default): `DROPBOX_REFRESH_TOKEN`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`
- Account 2: `DROPBOX_REFRESH_TOKEN_2`, `DROPBOX_APP_KEY_2`, `DROPBOX_APP_SECRET_2`, `DROPBOX_ACCOUNT_2_EMAIL`

**Scanner-side wiring:** `fetch_credentials_from_portal` in
`windows-scanner/drive_scanner.py` passes `?machine=<get_machine_name()>` to
`/api/scanner-credentials`. Old scanners that don't send the param still get
account-#1 creds — back-compat preserved. Bumping a machine's account
without a scanner rebuild requires editing PC's local `config.json` manually
and disabling the auto-fetch; far easier to just let the GitHub Actions
build ship a new .exe.

**Portal-side wizard hint:** `DownloadWizardModal` shows a blue banner on the
Add-to-Dropbox step when the project routes to account #2, telling the
operator which Dropbox login to use in the popup. Account #1 doesn't render
the banner (avoid noise on the common path). Both `dropbox-share-status` and
`scanner-credentials` return `dropbox_account_email` + `dropbox_account_index`
so the UI can render the banner without re-querying.

**Token cache must be keyed by `account_index`.** A single shared
`cachedAccessToken` will get clobbered when alternating PC1 and PC2 lookups;
use a `Map` keyed by account index so each account keeps its own cached
bearer token.

**Local Dropbox sign-in must match the OAuth account.** If PC2's local
Dropbox app is signed into the wrong email, the scanner adds the share to
account #2 in the cloud but the folder never appears at `dropbox_path`
locally (because that local folder syncs a *different* account). Operator
must verify: right-click Dropbox tray icon → confirm email matches
`DROPBOX_ACCOUNT_2_EMAIL`.

## GitHub Actions Windows scanner builder (2026-05-25)

`.github/workflows/build-windows-scanner.yml` builds the Windows .exe on
`windows-latest` runners on `workflow_dispatch`. Bumps `VERSION` in source,
runs PyInstaller (mirrors `build.bat`), computes SHA256 sidecar, commits
all three (`drive_scanner.py` + `dist/.exe` + `dist/.exe.sha256`) in **one
atomic commit** so the auto-updater never sees a VERSION-without-exe state
(the zombie-defense self-kill trap). Replaces the old "spin up a Windows PC,
build manually, push" dance. **Manual trigger only** — Zain decides when to
ship. Optional `target_version` input pins an exact semver; blank
auto-bumps the patch.

**Pushing the workflow file itself requires `workflow` OAuth scope.** Plain
`gh auth login` or git-https without `workflow` will reject the push with
"refusing to allow an OAuth App to create or update workflow ... without
workflow scope". Fix: `gh auth refresh -s workflow`. Or create the file via
the GitHub web UI which doesn't need that scope.

**Clipboard paste mojibake (operator note).** Pasting UTF-8 with em-dashes
into GitHub's web editor via macOS clipboard sometimes corrupts characters
(`—` → `‚Äî`). Harmless in `Write-Host` strings but ugly in comments.
Don't bother fixing — it'll get cleaned up next time the file is edited.

## Single-instance lock — TCP port 49981 (2026-05-25, v3.55.0+)

Right after the singleton lock shipped, PC1 ran into a **zombie auto-update
loop** that accumulated 40+ scanner processes in the tray. Root cause: the
v3.51.0 auto-update shim downloads `.exe.new`, sleeps 3s, then `move /Y` to
overwrite the running .exe. If PyInstaller still holds the file lock when
the shim fires (very common — the bootloader keeps it open for as long as
the Python child runs), the move silently fails, then `start "" exe`
launches the *old* .exe again. New .exe starts, sees version mismatch,
writes shim, exits, shim launches old again → infinite loop, +1 tray icon
per cycle, ~every 5 min.

**Singleton lock fix:** at the top of `drive_scanner.py` (before any other
work), bind a TCP listener on `127.0.0.1:49981`. The OS gives atomic
exclusivity — if our bind fails, another scanner already owns the port, so
we exit silently. On any exit (clean or crash) the OS releases the port for
the next launch. Pure stdlib, no `pywin32`, no `ctypes` mutex needed.
Survives any failure mode that doesn't crash the OS.

Picked the "new defers to old" pattern over "new kills old" because the
running scanner may be mid-write to a download progress row; killing it
risks state corruption. The existing zombie-defense already handles
already-replaced-binary cleanup.

**Acid test for future regressions:**
```
Start-Process <exe>; Start-Sleep -Seconds 10
Get-Process BilalDriveMan-Scanner | Select Id, StartTime
```
Should yield the same PID pair (bootloader + child) you had before
launching. If new PIDs appear, the lock is broken.

**PyInstaller --onefile produces a parent + child process pair.** Bootloader
parent extracts the bundled Python runtime, then forks the actual Python
code as a child. Both show up under `Get-Process BilalDriveMan-Scanner` —
two PIDs is normal for ONE scanner instance. The singleton lock lives in
the Python code, so only the child binds the port. Don't panic when you see
two PIDs from a clean launch.

## Recovery — zombie scanner loop on Windows (operator runbook, 2026-05-25)

Visible signature: tray full of stacked tray icons, `taskkill` fails with
"Access is denied" from non-admin PowerShell, `BilalDriveMan-Scanner-update.bat`
windows pop up every few seconds.

Recovery sequence (admin PowerShell required for everything except step 1):

1. **Disconnect PC's internet first** — kills the auto-update loop at the
   source. Without internet the scanner can't fetch GitHub VERSION, so
   no new shims get written.
2. Loop-kill until clean (PowerShell as Admin):
   ```powershell
   while ($true) {
       Stop-Process -Name BilalDriveMan-Scanner -Force -ErrorAction SilentlyContinue
       Get-Process cmd -ErrorAction SilentlyContinue | Where-Object {
           $_.MainWindowTitle -like "*BilalDriveMan*"
       } | Stop-Process -Force -ErrorAction SilentlyContinue
       $bats = Get-ChildItem -Path C:\ -Filter "BilalDriveMan-Scanner-update.bat" -Recurse -ErrorAction SilentlyContinue
       if ($bats) { $bats | Remove-Item -Force -ErrorAction SilentlyContinue }
       $procs = Get-Process BilalDriveMan-Scanner -ErrorAction SilentlyContinue
       if (-not $procs -and -not $bats) { Write-Host "ALL CLEAR"; break }
       Start-Sleep -Milliseconds 300
   }
   ```
3. **Verify the on-disk .exe matches remote v3.55.0+ SHA** before reconnecting
   internet. If the .exe is still the old version (likely — the file lock
   may have blocked every shim), `Invoke-WebRequest` the new .exe to a
   `.new` sidecar, verify SHA against the GitHub raw `.sha256` sidecar,
   then `Move-Item` to overwrite. Only THEN reconnect internet and launch.

The v3.55.0 singleton lock makes this whole class of problem impossible
going forward, but the runbook stays here because old PCs running 3.51.0
will hit it during their first upgrade.

## Scanner config.json gotchas (2026-05-25)

Hit two distinct failure modes when editing `%APPDATA%\BilalDriveMan\config.json`
from PowerShell:

1. **`Set-Content -Encoding UTF8` writes a BOM** (bytes `EF BB BF` at the
   start of the file). Python's `json.load` may or may not handle the BOM
   depending on stdlib version; if it errors, `load_config()`'s
   `except: pass` falls through to `save_config(DEFAULT_CONFIG)` which
   **wipes every field back to defaults**. Use
   `[System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))`
   to write without BOM. Verify with
   `[System.IO.File]::ReadAllBytes($path)[0..2]` — first 3 bytes should NOT
   be `239 187 191`.
2. **Stop-Process doesn't guarantee the child died.** If you edit
   `config.json` while a scanner process is still alive, the scanner's next
   `save_config()` (e.g. via `fetch_credentials_from_portal`) overwrites
   your edits with its in-memory snapshot. Always:
   - `Stop-Process -Force` first
   - `Start-Sleep 5`
   - `Get-Process BilalDriveMan-Scanner` — must return nothing
   - THEN edit config, verify, restart.

## Live machines widget (2026-05-25)

`components/LiveMachines.js` at the top of the Dashboard self-polls
`/api/devices` every 5s, shows every machine with `isOnline=true` and
`lastSeen ≤ 60s`, plus pill chips for each connected drive. Lets Zain
glance at what's actually live without scrolling to the Machines page.
Independent of the page's 5-min refresh cycle so it stays fresh between
manual refreshes.
