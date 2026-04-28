# Bilal Drive Man — Living Project State

> **READ THIS FIRST at the start of every session.** This is the running source of truth for what the project is, how it works, what we've fixed, what's broken, and what's next. Update at the end of every task that changes behavior, ships code, or moves the architecture. CLAUDE.md (in repo root) is for stable conventions. This file is for evolving state.

Last updated: 2026-04-26 — added §0 Standing Operating Procedure.

---

## 0. Standing Operating Procedure (read every session)

These are the standing rules from Zain. They override prior session improvisation. If anything below conflicts with an old §10 entry, this section wins.

**Authority & ownership:**
- I (mac-Claude) am the boss. Win-Claude on AAHIL is my employee. I give directions, he executes and reports.
- I am also the working operator — I do the heavy lifting (code, git, architecture, docs, SQL, test orchestration). Win is testing-only on AAHIL.
- Final decisions are mine. I should ask win for his perspective when his AAHIL-side knowledge helps, weigh it, and decide.

**Polling cadence:**
- Check Slack every ~1 minute when I'm free / between tasks. Don't go dormant for long stretches without a reason.
- Win has the same protocol — autopolls Slack and reacts when free. I tell him what to do, expect a Slack-update after each task.
- If win's response time is dragging on a blocker, ping again rather than wait silently.

**Capabilities I have full access to (don't second-guess):**
- The browser (Supabase dashboard, Vercel, Notion, Gmail, OAuth Playground, anything else open in Claude-in-Chrome).
- Git: branch, commit, push, merge, cherry-pick. Always commit with explicit messages and Co-Authored-By; ship to main only when verified or explicitly approved.
- Supabase via the dashboard's Bearer-token endpoint (`POST https://api.supabase.com/v1/projects/dialxndobebudwexsubr/database/query`) for any read or write — including DDL, command insertion, row resets.
- Slack via the MCP — read + send messages in `#claude-coord` (C0AUX615GQK).
- Gmail via the open Chrome tab — compose + send emails to Zain when needed (his email: `zainansari0340@gmail.com`).

**When to email Zain (he is AFK by default — protect his attention):**
- ONLY for important decisions I can't make autonomously, OR for milestone reports.
- "GDrive workflow fully functional after E2E test" is the next milestone email — until then, work silently.
- For everyday status, just push commits + update this doc + Slack.

**E2E testing rules:**
- I drive the test. Win observes and reports.
- It's OK to rename a Notion test card slightly to force a fresh project row + fresh download_link if needed.
- When something fails, fix it in real-time if I can; otherwise tell win and let him execute.
- Make a feature *fully functional* before reporting up to Zain. Half-working is not done.

**Coordination protocol with win:**
- I assign tasks; win acks; win reports completion with concrete artifacts (commit SHA, PID list, log line, file path).
- Win's specific value-adds: physical access to AAHIL filesystem, Dropbox/Drive desktop client state, scanner.log tail, `tasklist` output, .exe rebuild via build.sh.
- If a task is purely portal-side (API endpoints, components, SQL, docs), I don't need win — just ship.
- If a task needs scanner code change → I write the code, win runs build.sh on AAHIL and ships the .exe + sidecar. Branch flow (don't push source to main without paired .exe).

**Self-management:**
- When my context approaches 50%, I run `/compact` myself and update this doc with anything new since last update so the next compaction round still has full state.
- Update this doc after every task that ships a commit or changes behavior. §10 is the running session log.

---

## 1. What this software is

Bilal Drive Man is a **wedding-photo download + drive-management dashboard** for a single small studio. Bilal (the studio owner) receives client photo shares — typically Dropbox folders, Google Drive folders, or WeTransfer transfers — and needs to:

1. **Pull every share down to a local external drive** (e.g. "Extreme Pro 4TB", "Hawaii 4TB") under the right `client/couple` folder structure, idempotent and resumable.
2. **Track which couple's photos live on which drive** so he can find a shoot from a year ago without plugging in five disks.
3. **Know the live state of every drive** (connected, free space, last scan, what's on it) from a single web UI.

The system is designed for **two operator PCs** (`AAHIL` Windows box and a Mac) plus a **central Vercel-hosted dashboard** at `bilal-drive-man.vercel.app`. Notion is the source of truth for the project list (Bilal types couple names + share URLs into a Notion database; a sync endpoint mirrors them into Supabase).

### Why custom (not Dropbox/Drive sync clients)?
- **Dropbox shares larger than the account quota can't be added to the user's cloud** — we needed a direct-download path that doesn't require "Add to my Dropbox".
- **Google Drive shared folders with thousands of files time out the official desktop client** — direct API download with parallelism + range resume is more reliable.
- **WeTransfer expires** — we need to grab everything before the 7-day window closes; an automated pull is just less stressful than remembering.

Built for one user with high reliability requirements. No multi-tenancy, no public signups.

---

## 2. Architecture (high-level)

```
┌────────────────────────┐        ┌──────────────────────────┐
│  Notion database       │        │  External drives         │
│  (project list, links) │        │  (Extreme Pro, Hawaii…)  │
└──────────┬─────────────┘        └────────────▲─────────────┘
           │ /api/notion-sync                  │ scanner enumerates +
           │ (cron, every ~10 min)             │ copies couple folders
           ▼                                   │
┌────────────────────────────────┐   ┌─────────┴─────────────┐
│  Supabase (PostgreSQL)         │◀──│  Scanner (Python)     │
│  - download_projects           │   │  - macOS LaunchAgent  │
│  - download_commands (queue)   │──▶│  - Windows .exe       │
│  - download_progress           │   │  Polls /download-     │
│  - drives, clients, couples    │   │  commands every ~10s  │
└──────────┬─────────────────────┘   └────────────────────────┘
           │ REST (PostgREST)
           ▼
┌────────────────────────────────┐
│  Vercel (Next.js portal)       │
│  - dashboard UI                │
│  - download wizard             │
│  - /api/* endpoints            │
│    (download-projects,         │
│     gdrive-share-status,       │
│     dropbox-share-status,      │
│     wetransfer-share-status,   │
│     notion-sync, drives, …)    │
└────────────────────────────────┘
```

### The download flow (when Bilal hits "Download now" in the wizard)

1. **Wizard fires `POST /api/download-projects?action=download_now`** with project_id, target_drive, assigned_machine.
2. Portal flips `download_projects.download_status` to `downloading` and inserts a command row into `download_commands` with `command='add_to_cloud'` and the assigned machine's name. (For all three link types — wizard always issues `add_to_cloud` first, then `start_download`.)
3. **Scanner on the assigned PC polls `download_commands`** filtered by its machine name + `status='pending'`. Picks up the command, marks `processing`, runs the handler.
4. **`handle_add_to_cloud` dispatches by `link_type`:**
   - `dropbox` → `add_dropbox_shared_folder` (mounts the share into the user's Dropbox, returns folder name)
   - `google_drive` → `call_with_token_retry` → `add_gdrive_shared_folder` (3.46.0 direct-download, returns absolute staging dir path) ← **Requires `gdrive_*` keys in scanner config.json**
   - `wetransfer` → `add_wetransfer_share` (3.47.0 direct-download via `wetransfer_provider`, returns absolute staging dir path)
5. Scanner patches `download_projects.cloud_folder_path` with the result, marks `add_to_cloud` command `completed`.
6. Portal/scanner queues `start_download` command (sometimes the wizard pre-queues it — see `download-projects.js`).
7. **`handle_start_download`** monitors the cloud folder until files are fully offline (Dropbox sync) OR copies straight from the staging dir (gdrive/wetransfer direct-download). Then `handle_copy_to_drive` rsync-copies couple folders to `target_drive`.
8. On copy success: cleanup staging directory (3.47.1 ensures cancel also cleans it up), patch `download_status='completed'`, sync Notion status to "Done".

### Key constraints
- **Scanner credentials live in local `config.json`** on each PC (`%APPDATA%/BilalDriveMan/config.json` on Windows, `~/Library/Application Support/BilalDriveMan/config.json` on macOS). `cloud_accounts` Supabase table is currently **empty** — no central credential store exists. This is the single biggest known footgun (see "Open architectural items" §6).
- **Vercel env vars hold a separate copy of the same OAuth credentials**, used only by `/api/gdrive-share-status` to validate share URLs *before* the scanner attempts the download. The dual-config means a portal-side share-validation pass does NOT prove the scanner can actually authenticate.
- **Scanner `.exe` auto-updates** via a SHA-verified batch-shim mechanism. Source `VERSION` string + bundled .exe + sidecar SHA must be a triple-match or you get an auto-update zombie loop (we've hit this twice — see "Recent fixes" §4).

---

## 3. Current state — what works / what's broken

### ✅ Working

| Subsystem | Status | Notes |
|---|---|---|
| Drive enumeration & dashboard tabs | Working | Junk-drive filter (Docker/WSL/<1GB) shipped `bf0987f` 2026-04-25. |
| Couple search + drive listing | Working | Server-rendered, 1-query nested select. |
| Notion → Supabase sync | Working | Cron-driven via Vercel. |
| Scanner command pipeline | Working | Confirmed E2E 2026-04-26: insert → pickup (within ~60s) → handler → status patch back. |
| Auto-update mechanism | Working w/ caveat | Three regression cycles today (3.45.0, 3.47.0/3.47.1) all caused by stale `__pycache__`. **Fixed by `build.sh` wrapper (`db91f9a`) — must always use it.** |
| Dropbox download path | Untested this cycle | Last verified working ~2 weeks ago. No reason to think it's broken. |
| Live progress bar | Working as of 2026-04-25 | `total_bytes_expected` migration applied; portal reads `progress_bytes` (not `download_progress_bytes` legacy). |
| Cancel-then-remove hygiene | Working | `c7c43aa` Scanner 3.47.1 cleans staging dirs on CancelledError. |

### ❌ Broken / blocked

| Issue | Severity | Owner | Notes |
|---|---|---|---|
| ~~GDrive direct-download fails on AAHIL~~ | ~~High~~ | RESOLVED | Closed by 3.49.2 — credentials now auto-fetched from `/api/scanner-credentials`. Live-tested 2026-04-26 with `arfoglow` folder; 7/12 files (462 MiB) downloaded successfully, partial-failure tracking working. |
| GDrive trailing-whitespace folders break os.makedirs | Medium | Mac (3.50.0 next) | Folder named `"montage reference two "` caused `[Errno 2] No such file or directory` on 3 files in 2026-04-26 test. Fix: `.rstrip()` each path segment before join. |
| Dropbox folder vanishes during materialize-wait | Low | Investigate | In 2026-04-26 test, `C:\Users\txbla\Dropbox\ZAINN testing` existed at `add_to_cloud` time but was missing 44 minutes later when `start_download` ran. Scanner errored cleanly but couldn't re-mount. Probable Files-On-Demand eviction. Needs reproducible repro before fix. |
| Partial-failure silent-pass | Medium | Mac (defer) | When `add_*_share` returns `complete_with_failures` (some files 404'd), scanner proceeds with copy + portal flips to `completed`. User sees green check on what was actually a partial archive. Failed filenames sit in `.staging-state.json` but never reach UI. |
| GDrive folder-listing has no cancel check | Low | Mac (defer) | Long folder enumerations can't be cancelled until first file starts. Low-risk in practice. |

### ⏸ Not yet tested / unknowns
- WeTransfer direct-download (3.47.0): code-reviewed only, no live smoke test. First real WeTransfer download will be the de-facto smoke.
- Multi-PC scanner coordination: only AAHIL is currently active. Mac LaunchAgent has historically run but isn't wired into today's flow.

---

## 4. Recent fixes — running log (most recent first)

> **Format:** `<commit>` — `<date> <author>` — short description. Add an entry every time you push.

- `bf0987f` — 2026-04-25 mac — Drives tab junk filter (Docker, WSL, virtual mounts, <1 GB) at both `lib/supabase.js` (display layer) + `windows-scanner/drive_scanner.py` (enum layer).
- `c7c43aa` — 2026-04-25 mac — Scanner 3.47.1 staging cleanup on cancel; `_safe_run_command` CancelledError branch now best-effort cleans both gdrive + wetransfer staging roots so cancel-then-remove no longer leaves orphan bytes.
- `8e628e1` — 2026-04-25 mac (cherry-pick of win's `e8929fd`) — Scanner 3.47.1 .exe rebuild (mac source-bumped VERSION but never ran PyInstaller; main shipped a stale 3.47.0 binary with 3.47.1 sidecar → AAHIL auto-update zombie loop, 8 zombies accumulated; win killed + rebuilt clean; fresh SHA `5c2e4837...`).
- `db91f9a` — 2026-04-25 win — `windows-scanner/build.sh` wrapper enforcing `--clean` + dirty-tree refusal + auto-SHA write, plus an "Auto-update regression test" section in CLAUDE.md. Lives on `scanner-3.47.2-build-script` branch — **not yet merged to main** as of this writing.
- `21e3e9f` — 2026-04-25 mac — CLAUDE.md doc updates (WeTransfer endpoint, remove-action hygiene, progress_bytes footgun, two-Claude coordination rules).
- `8e26d35` — 2026-04-25 mac — Portal reads `progress_bytes` (live) not `download_progress_bytes` (stale, never written).
- `eb46ba1` — 2026-04-25 mac — `/api/wetransfer-share-status` accepts `?url=` for ad-hoc QA without a Notion-synced project.
- `d6c2dd9` — 2026-04-25 mac — `remove` action posts `cancel_download` to scanner + syncs Notion before delete.
- `01d37b9` — 2026-04-25 mac — Portal progress bar prefers `total_bytes_expected` denom.
- `e9b4a34` — 2026-04-25 win — Scanner 3.47.0 WeTransfer integration.
- `4dcb16c` + `df98384` — 2026-04-25 — Scanner 3.46.0 + 3.46.1 GDrive direct-download (`add_gdrive_shared_folder` returns abs staging path, telemetry phase = `gdrive_staging`).
- `4666ae4` — 2026-04-25 mac — `windows-scanner/wetransfer_provider.py` (production-ready primitives).
- `5bd6123` — 2026-04-25 mac — `/api/gdrive-share-status` + GDrive wizard branch.
- `a0b95ff` — 2026-04-25 mac — WeTransfer un-block + `/api/wetransfer-share-status`.
- `e32840d` + `3f925c7` — 2026-04-25 — Scanner 3.45.0 race/concurrency hardening + .exe hotfix (first auto-update zombie cycle).
- **Supabase migration applied 2026-04-25 19:57 PKT:** `ALTER TABLE download_projects ADD COLUMN IF NOT EXISTS total_bytes_expected BIGINT;` Live progress bar now wired end-to-end.

---

## 5. Known issues, footguns, and workarounds

### Auto-update zombie loop (AAHIL self-DOS)
**Symptom:** scanner.log shows `Auto-update: remote v3.47.1 differs from local v3.47.0, downloading .exe` every ~60s, with multiple `BilalDriveMan-Scanner.exe` PIDs accumulating.
**Cause:** stale `windows-scanner/__pycache__/drive_scanner.cpython-*.pyc` got bundled by PyInstaller, so the new .exe self-reports the OLD version. Auto-update sees a mismatch with main's sidecar, pulls "new" .exe (which is the same broken binary), restarts, still old version → loop.
**Fix:** **always** run scanner builds via `windows-scanner/build.sh` (`db91f9a`). It enforces `rm -rf build/ __pycache__/ windows-scanner/__pycache__/` + `pyinstaller --clean` and auto-writes the SHA sidecar from the actually-built binary. Refuses to run if `git status --porcelain` is dirty.
**Recovery if you hit it:** kill all `BilalDriveMan-Scanner.exe` PIDs, delete any `*.exe.new` artifacts, rebuild with `build.sh`, push, restart scanner.

### `progress_bytes` vs `download_progress_bytes` (legacy)
Two columns exist, both `bigint`. Scanner writes to **`progress_bytes`**. Old portal code read `download_progress_bytes` (always 0). Fixed in `8e26d35`. If you add new portal code that needs progress, read `progress_bytes` (and `total_bytes_expected` as denominator).

### Scanner credentials in two places
Vercel env vars (used by `/api/gdrive-share-status` for share-URL pre-validation) and `config.json` on each scanner PC (used by the actual download handler). The dual-config means **a green wizard validation does NOT prove the scanner can authenticate**. Fix is the centralized credentials endpoint (§6 backlog).

### Slack secrets policy
**Never paste long-lived OAuth tokens / refresh tokens / API keys / passwords in the `#claude-coord` channel.** Slack history is permanent and treats the channel as a credential transmission channel breaks the leakage policy. If win needs creds on AAHIL: Zain pastes them in his AAHIL-side Claude session, OR sends them via his second Gmail account, OR generates fresh creds via OAuth Playground on AAHIL. (Standoff that ate ~3hr on 2026-04-25 — see Slack history if needed.)

---

## 6. Open architectural items (backlog)

- **`/api/scanner-credentials` endpoint** — centralize OAuth credential storage so a new PC can pull credentials at scanner boot instead of needing a manual `config.json` edit. Removes the dual-config footgun. Mac side; medium effort. Requested as `scanner-3.48.0` backlog.
- **Wizard pre-check** — before `download_now` queues `add_to_cloud`, the portal could check if the assigned scanner has credentials configured (via the above endpoint) and fail-fast with `"Configure GDrive credentials on <machine> first"` instead of letting the scanner-side fail silently. Depends on the credentials endpoint shipping first.
- **Partial-failure visibility** — surface `failed_files{}` from `.staging-state.json` to the portal UI; either threshold-fail or annotate the "completed" badge with a count.
- **Staging-state surfacing** — `.staging-state.json` has `failed_files{}` with reason+attempts; not currently exposed in portal.
- **`scanner-3.47.2-build-script` branch merge** — `db91f9a` lives on a branch, not merged to main. Should be merged so future builds inherit the wrapper. (Decision: defer until next scanner change cycle so we can verify the wrapper works end-to-end on a real change.)

---

## 7. Task ownership — Mac vs Win

> **As of 2026-04-26: Zain is consolidating to mac-Claude only. Win-Claude is now testing-only — its sole job is to be the operator on the AAHIL Windows box where the actual GDrive/Dropbox/WeTransfer downloads run.**

### Mac-Claude (me) handles all of:
- All code edits to portal (`pages/`, `components/`, `lib/`, `styles/`)
- All code edits to scanner Python (`windows-scanner/drive_scanner.py`, `windows-scanner/wetransfer_provider.py`, `mac-scanner/`)
- All git operations: commit, push, branch, cherry-pick (NEVER auto-commit without Zain's explicit greenlight)
- Supabase queries (read state, debug, reset stuck rows) via the Bearer token from the dashboard browser session
- Vercel runtime log audits
- Portal dashboard / Slack / OAuth-Playground tabs in Chrome
- Documentation: this file + `CLAUDE.md` + commit messages
- Build-script + version-bump discipline (`build.sh` for Windows, source `VERSION` constant)
- Scanner `.exe` rebuilds via `build.sh` when source changes (and committing both `.exe` + `.sha256` sidecar)
- All architectural design + pre-checks + endpoint design

### Win-Claude (AAHIL) handles only:
- Live testing of Dropbox / Google Drive / WeTransfer downloads (it's the only side with the cloud client apps + share-link permissions)
- Tailing `scanner.log` on AAHIL during a live test (reports errors to Slack)
- One-time local config edits (e.g. `%APPDATA%/BilalDriveMan/config.json` writes when Zain provides credentials directly to that side)
- Process management on AAHIL (kill zombies, relaunch scanner) when needed for recovery

**Anything win used to do that's not in that list, mac now owns.** If win's session goes dormant, none of mac's work is blocked except live-test execution.

---

## 8. How to update this file

**At the end of every task that:**
- ships a commit
- changes architecture or behavior
- adds/closes a known issue
- moves the state of any subsystem

…edit the relevant section. Keep entries dated and signed (e.g. `2026-04-26 mac`). Never delete history — append. If a section gets stale, mark items as `~~struck out~~` and add the replacement underneath rather than deleting.

**At session start:** read this file top-to-bottom *before* doing anything else. Cross-reference §3 (current state) and §4 (recent fixes) against what Zain is asking for so you don't re-do something already done or step on a known footgun.

**At session end (or after a "morning task" wrap):** update §3 and append a §4 entry for any commit you shipped. Append §5 entries for any new footguns you discovered.

---

## 9. Useful one-liners (for me)

- **Find the gdrive-test project state:**
  ```sql
  SELECT id, download_status, download_phase, error_message, updated_at
  FROM download_projects WHERE link_type='google_drive' ORDER BY updated_at DESC LIMIT 5;
  ```
- **Reset a stuck project to idle:**
  ```sql
  UPDATE download_projects SET download_status='idle', download_phase=NULL,
    error_message=NULL, progress_bytes=0, total_bytes_expected=NULL,
    cloud_status='pending', cloud_folder_path=NULL
  WHERE id='<project-uuid>' RETURNING *;
  ```
- **Manually fire add_to_cloud for E2E testing (bypass portal):**
  ```sql
  INSERT INTO download_commands (machine_name, command, project_id, payload, status)
  SELECT 'AAHIL', 'add_to_cloud', id,
    jsonb_build_object('download_link', download_link, 'link_type', link_type,
                       'couple_name', couple_name, 'cloud_account_id', NULL),
    'pending'
  FROM download_projects WHERE id='<project-uuid>'
  RETURNING id, command, status, created_at;
  ```
- **Check command result:**
  ```sql
  SELECT command, status, error_message, created_at, completed_at
  FROM download_commands WHERE project_id='<project-uuid>'
  ORDER BY created_at DESC LIMIT 5;
  ```
- **Supabase Bearer-token query template (run inside the Supabase dashboard tab):**
  ```js
  const tok = JSON.parse(localStorage['supabase.dashboard.auth.token']);
  await fetch('https://api.supabase.com/v1/projects/dialxndobebudwexsubr/database/query', {
    method: 'POST', credentials: 'include',
    headers: {'Content-Type':'application/json', 'Authorization': 'Bearer ' + tok.access_token},
    body: JSON.stringify({query: "<SQL>"})
  }).then(r => r.text());
  ```

---

## 10. Today's session log (rolling — wipe & restart at next morning's session)

- 2026-04-25 evening:
  - Shipped junk-drive filter (`bf0987f`).
  - Shipped scanner 3.47.1 cancel-cleanup (`c7c43aa`); broke .exe; cherry-picked win's hotfix (`8e628e1`).
  - Applied Supabase migration `total_bytes_expected BIGINT` via dashboard endpoint.
  - Win shipped `build.sh` wrapper on `scanner-3.47.2-build-script` branch (`db91f9a`).
  - GDrive E2E test fired (project `eddba0c4`); failed at `add_to_cloud` with "No google_drive token configured in scanner settings". Root cause: AAHIL `config.json` has empty gdrive credentials.
  - Held line on declining to paste OAuth refresh tokens in Slack history.
- 2026-04-26 early hours:
  - Re-fired GDrive E2E test (mac-side direct command insert). Same error confirmed: scanner alive, pipeline working, AAHIL config still empty.
  - Created this PROJECT_STATE.md and consolidated state ahead of taking over win's responsibilities.
- 2026-04-26 evening (cycle wrap):
  - **copy_to_drive partial test fired (cmd `14dcb4ed`).** Re-fired `start_download` for `eddba0c4` with explicit `cloud_folder_path` pointing to the populated GDrive staging dir + `target_drive='extreme pro'`. Scanner executed the **entire pipeline cleanly through the 5-step happy path:**
    - 21:21:24 `Monitoring cloud folder: <staging dir>` — Path A activated, no 90s wait
    - 21:21:33 `Pinned 10/10 files for offline download`
    - 21:21:45 `Cloud check #1: 10/10 files offline`
    - 21:21:45 `All 10 files are offline! Starting copy...`
    - 21:21:45 `ERROR: Target drive not found: extreme pro` — **environmental, not a code bug**
  - **Extreme Pro (D:) is unplugged from AAHIL** (last "Detected drive" log entry was 19:23:55 PKT, ~2hrs before the GDrive download even started). The 7 GDrive files (462 MiB) are sitting in staging at `C:\Users\txbla\AppData\Local\BilalDriveMan\gdrive-staging\eddba0c4-.../` waiting for the drive to come back. Re-fire same `start_download` once Bilal reconnects Extreme Pro.
  - **Net for the morning task:** the GDrive download flow is **proven working end-to-end** through every code path that doesn't require physical hardware presence. v3.46.0 direct-download → v3.47.1 staging hygiene → handle_start_download Path A → handle_copy_to_drive's drive-presence check. Last step halts cleanly with actionable error when target drive missing — exactly the right behavior.
  - **CLAUDE.md durable-conventions update:** added 5 new sections / rules captured from today's chase:
    1. `## Scanner credentials architecture (v3.49.2+)` — `/api/scanner-credentials` is source of truth, never manually edit OAuth keys in `config.json`
    2. `### Pre-merge runtime-verification trap` — never runtime-launch ahead-of-main scanner builds, use CArchiveReader static verification
    3. Branch-flow for new scanner versions (mac source change → win .exe rebuild → mac merge)
    4. Trailing-whitespace folder limitation noted in GDrive flow section
    5. `## Diagnostic discipline on Windows (AAHIL)` — `cat path | python` not `python -c "open"`, heartbeat upsert footgun, network-isolated scanner can still download
  - Two-Claude Coordination section rewritten: mac owns all dev work, win is testing-only.
- 2026-04-26 late afternoon:
  - **AAHIL scanner died unexpectedly at ~14:14 PKT.** PIDs 9336 + 1876 gone, no traceback, no graceful shutdown line. Last log line was a normal drive-detect tick. Win discovered ~30 min later when starting the 3.49.0 build cycle. Probable cause: OS sleep/lock during a DNS-flap (network errors had been recurring just before the gap). Logged as a known-but-unexplained failure mode. **Workaround:** scanner runs as a tray app, not a service — if AAHIL is going to be unattended for long stretches, install it as a Windows service so the OS can't kill the orphan. Backlog item.
  - **Architectural fix shipped: `/api/scanner-credentials` endpoint + scanner auto-fetch.** Vercel-side endpoint returns Dropbox + GDrive OAuth credentials gated by SYNC_API_KEY. Scanner pulls at startup, merges into in-memory config, persists locally. Closes the dual-config footgun (PROJECT_STATE §6 architectural item). Adding a new PC = install scanner → auto-fetch creds → ready, no manual config.json edit.
  - **🐛 Live bug found in 3.49.0 fetch_credentials_from_portal:** scanner.log says `refreshed local config (dropbox=yes, gdrive=yes). Persisted to disk.` but config.json on AAHIL has all 6 sensitive keys empty (len=0). Mtime updates so save_config DID write — but the values written are empty. External API probe returns populated values, bytecode static-verified to match source. Win observed in two test runs. **3.49.1 in flight on branch `scanner-3.49.1-credentials-diagnostic` (`a116179`)** — adds three layers of diagnostic logging (response shape with redacted lengths, updates-applied tuple, post-save disk verify) to pinpoint whether the bug is at the endpoint layer, the change-loop layer, or the save_config layer. Awaiting win's .exe rebuild + log paste.
  - **3.49.1 → 3.49.2 force-write fix shipped (commits `d535ed9`, `261bc42` on main).** Diagnostic logs revealed the persist "bug" was actually a Windows file-read quirk in win's verification tool (`python -c "open(path).read()"` returned stale/cached content; `cat path | python` showed real values). 3.49.2 still ships the fix (drop the `local_v != v` comparison, always write when portal returns populated values) — pragmatic correctness improvement that sidesteps any future false-negative comparison risk. **Diagnostic discipline rule added:** when verifying Windows config.json contents, use `cat path | python -c "..."`, never `python -c "open(path).read()"`.
  - **🎯 Live E2E download test fired (20:00 PKT) with full v3.49.2 stack:**
    - **GDrive direct-download (3.46.0): proven working end-to-end.** Folder `arfoglow` (12 files, ~1.12 GiB), 7 files completed (~462 MiB), 5 failed: 2 retries-exhausted from network drops, 3 from a NEW BUG (trailing-whitespace folder names). Bytes are real on disk at `C:\Users\txbla\AppData\Local\BilalDriveMan\gdrive-staging\eddba0c4.../`. v3.47.1 staging-state.json tracking captured all failures cleanly.
    - **Dropbox add_to_cloud (3.42.0+3.48.0): proven working.** `add_dropbox_shared_folder` succeeded with the v3.42.0 graceful "already in user's namespace" path. cloud_folder_path persisted to project row.
    - **Dropbox start_download: failed for environmental reason** — between `add_to_cloud` success at 19:51 and `start_download` at 20:35, the `C:\Users\txbla\Dropbox\ZAINN testing` folder vanished from disk. `ls` on AAHIL returns `No such file or directory`. Root cause unclear (Files-On-Demand eviction during DNS outage? share unmounted? manual delete?). Scanner correctly waited 90s + reported actionable error — NOT a scanner bug.
    - **Network instability on AAHIL** caused intermittent DNS failures throughout the test. Heartbeats stalled for ~38 min mid-cycle. Scanner remained alive and continued downloading from `googleapis.com` (different DNS path than `bilal-drive-man.vercel.app`).
  - **NEW BUGS surfaced (real follow-up work):**
    1. **Trailing-whitespace folder names break `os.makedirs` on Windows.** GDrive folder named `"montage reference two "` (trailing space) caused `[Errno 2] No such file or directory` on three files. Fix: `.rstrip()` each path segment before `os.path.join()`, or use `pathlib`. Schedule as scanner-3.50.0.
    2. **Dropbox folder eviction during materialization-wait.** When local folder vanishes between `add_to_cloud` and `start_download`, scanner errors but doesn't try to re-mount via `add_dropbox_shared_folder` again. Could add a "folder vanished, attempting re-mount" recovery path. Lower priority — needs reproducible repro first.
    3. **Race condition in production wizard** — `start_download` is queued at the same instant as `add_to_cloud` with empty `cloud_folder_path`, scanner falls back to `find_cloud_folder` (Path B). Works in production-typical setups (Bilal's couples folders match by name) but failed in this test for unclear reasons. Backlog: have `handle_start_download` re-fetch project row to get latest `cloud_folder_path` before falling back to find_cloud_folder.
  - Commits (in order): `b7e9e1c` portal endpoint → `d5c7b33` scanner Dropbox shortcut → `86b204c` scanner credentials fetch → `77fca13` v3.49.0 .exe + SHA sidecar → `1b240f1` merged to main as a no-ff merge preserving the lineage. Endpoint live-verified via curl: `{dropbox: present, google_drive: present}`. SHA on main: `bd65b8437d144b70b902733e1c00faa52582e06b91df0a02776fe7b22c764d0e`.
  - **Pre-merge runtime-verification trap discovered (worth permanent rule):** if scanner local VERSION is *ahead* of main's VERSION, the boot-time `auto_update()` will trigger a *downgrade* — peek remote main, see local > remote, swap own .exe with main's stale binary. This corrupts the build without warning. Win caught it, switched to *static* verification via PyInstaller `CArchiveReader` (inspect bundled bytecode + walk `co_consts` for VERSION + function names). **Rule: when verifying a scanner build that's ahead of main, do NOT runtime-launch — use CArchiveReader static inspection instead.**
  - **Dead branch deleted on remote:** `scanner-3.48.0-cloud-folder-shortcut`. 3.49.0 supersedes.
- 2026-04-26 afternoon:
  - **Live E2E self-test fired** for both Dropbox ("ZAINN testing") and Google Drive ("gdrive-test - DO NOT DELETE") — driven via direct `download_commands` insert (mac side).
  - *New finding:* Dropbox is also blocked on AAHIL. `add_to_cloud` failed with `"No dropbox token configured in scanner settings"`. Earlier assumption that Dropbox was working was wrong — the previously-completed ZAINN row succeeded only because `cloud_folder_path` was already mounted; OAuth credentials are missing too. Both Dropbox AND GDrive scanner credentials must be populated on AAHIL `config.json` to unblock real downloads.
  - *UX bug discovered (deferred):* when commands fail, the *project* stays in `download_status='downloading'` indefinitely. Scanner only patches the command, not the project. Wizard shows a spinner forever — silent failure UX. Worth a follow-up patch.
  - **Re-download / project-reset workflow shipped (Options A + B both portal-side, no scanner change):**
    - `a72decb` — Option B: manual "Re-download" button on completed projects + `?action=reset` endpoint. Confirms with dialog, clears completion state, re-opens download wizard.
    - `76f8a32` — Option A: auto-reset on couple-folder deletion. `/api/sync.js` now detects when a previously-present couple disappears from all connected drives + flips matching completed `download_projects` back to `idle` (clears `cloud_folder_path` + Notion-mirrors 'idle'). History event `projects_auto_reset` is written for audit. Multi-drive case handled (project stays completed until ALL copies gone).
- 2026-04-26 midday:
  - **Mac-Claude takeover from win-Claude complete.** Per Zain's consolidation directive: I (mac) own all code, git, architecture, docs going forward. Win is testing-only on AAHIL.
  - Shipped `c05f86b` — this PROJECT_STATE.md as the session-start source of truth.
  - Merged win's `scanner-3.47.2-build-script` (`db91f9a`) into main as `d400271` — `windows-scanner/build.sh` + auto-update regression doc + `.gitignore`/`.gitattributes` are now on main.
  - Win audited AAHIL state: nothing local-only worth pushing. Stash @{0} contents superseded — dropping. No rogue `.md` files. `windows-scanner/dist/` only has the canonical pair. Confirmed `config.json` + `scanner.log` + `build/` artifacts intentionally never committed.
  - Win's local `.exe` is 1309 bytes off main's canonical (16,601,648 vs 16,600,339; PyInstaller bundle stamping difference, functionally identical v3.47.1). Won't push. Will self-reconcile on next scanner restart.
  - **AAHIL operational snapshot (per win, recorded for next session):**
    - Scanner v3.47.1 running, PIDs alive from yesterday's launch
    - `%APPDATA%/BilalDriveMan/config.json` GDrive credentials still empty — *unchanged blocker*
    - scanner.log: clean drive-detect ticks, no errors
    - Win autopolls Slack at 2-3 min cadence; mac autopolls 5-30 min based on activity
- **2026-04-28 midday — scanner-3.50.0 + 3.50.1 shipped, full E2E test cycle COMPLETE:**
  - **GDrive workaround copy succeeded (cmd `f88bdfff`).** Project `eddba0c4` reached `completed` at 12:51 PKT — yesterday's 7 partial files (+the recovered `montage reference two/` files via 3.50.0) shipped to D:. Manual `target_drive='Extreme Pro'` exact-casing was required because of bug #4 (case-sensitive label match) — root-caused, fixed in 3.50.0.
  - **scanner-3.50.0 shipped with 4 fixes (`375004b` on main):**
    1. **Bug #1 trailing-whitespace folder names** (`montage reference two ` etc.) → `.rstrip(' .')` per path segment in `_download_task`. Yesterday lost 3 files; today all 12 land.
    2. **Bug #2 wizard-race** in `handle_start_download` → re-fetches project row from new GET `/api/download-projects?id=X` before falling through to `find_cloud_folder`. Picks up `cloud_folder_path` backfilled by `add_to_cloud` even when the start_download payload arrives with empty path.
    3. **Bug #3 Dropbox materialize-wait disambiguation** → new helper `dropbox_check_cloud_path_exists` calls `/2/files/get_metadata` after the 90s wait fails. Distinguishes "vanished cloud-side" (recipient unshared, share expired) from "Dropbox desktop client lagging."
    4. **Bug #4 case-sensitive `target_drive` label match** in `handle_copy_to_drive` + `handle_delete_data` → `(label or '').strip().casefold() == norm_target`. Same bug present since wizard started lowercasing labels.
  - **scanner-3.50.1 hotfix shipped (`433e730` on main):** 3.50.0 fix #2 duplicated the materialize-wait code into the new backfill branch but DIDN'T copy the fix #3 cloud-side check call (off-by-one mistake on my part). 3.50.1 mirrors the call into both branches. Backlog: refactor `_handle_materialize_wait_or_fail()` into a shared helper for 3.51.0.
  - **bug #5 server-side patch (`4b466cd` on main):** scanner-3.50.0's new GET `/api/download-projects?id=X` was wrapped in `requireAuth` (cookie-only). Scanner sends `X-API-Key`. New helper `requireAuthOrApiKey` accepts either path. Unblocked fix #2 entirely.
  - **All 5 fixes proven on production traffic in this session:**
    - Fix #1: 12/12 GDrive files including 3 `montage reference two/` (was 9/12 yesterday → 0 trailing-whitespace failures today)
    - Fix #2: log line `start_download: payload had empty cloud_folder_path, backfilled from project row: <path>` confirmed
    - Fix #3: Dropbox failure now emits `Cloud folder ... is no longer present in Dropbox itself...` when share has vanished cloud-side. Confirmed on `2c59cd1c` (the ZAINN testing share is genuinely gone from Dropbox).
    - Fix #4: GDrive copy succeeded via `'extreme pro'` lowercased label
    - Fix #5: Vercel `HTTP 200` on `/api/download-projects?id=X` with X-API-Key
  - **Auto-update zombie loop trap fired AGAIN** despite being documented in CLAUDE.md. PIDs from yesterday + today's chain held the .exe lock; new build downloaded but never loaded. Win caught it via SHA-vs-VERSION mismatch, remediated with `taskkill /F` + direct-launch from dist/. **Lesson:** the disk-SHA == remote-SHA check isn't enough. Need bytecode-level check that the *running* process is the version it claims. Cataloged as 3.51.0 hardening:
    - Option (a) "if local SHA on disk matches remote and in-mem VERSION ≠ disk VERSION → I'm a zombie, taskkill self"
    - Option (c) "I keep downloading the same SHA repeatedly → log RED" telemetry
  - **Today's GDrive E2E: closed.** Project `eddba0c4` `completed` again at 13:49:26 PKT, 742 MB copied to `D:\zain\gdrive-test - DO NOT DELETE\` with full `revised/` hierarchy (including the 3 trailing-whitespace files that failed yesterday).
  - **Today's Dropbox E2E: code path proven.** ZAINN testing share is genuinely gone from Dropbox cloud-side. System now correctly directs operator to "re-add via Notion or have share owner re-share" instead of misleading them toward Dropbox desktop client. Real-world resolution: Bilal/owner re-share, then re-fire wizard.
  - **Bug #6 (cosmetic, deferred):** `failed_files` dict in `.staging-state.json` doesn't drop entries when a file later succeeds. The "X ok, Y failed" tally in the final log line over-counts failures. Net file-on-disk count is correct. 3.50.x cleanup item.
- **2026-04-28 evening — scanner-3.51.0 + final E2E success on both clouds. Win-Claude handover initiated.**
  - **scanner-3.51.0 shipped (`54d0922`/`f439914` on main):** ships fixes #6 + #7.
    - **Bug #6 (failed_files cleanup):** `failed.pop(fid, None)` added in BOTH success branches (gdrive download loop + wetransfer download loop). Retry-success now drops stale `.staging-state.json` entries; final tally is accurate.
    - **Bug #7 (zombie self-defense):** new in-process guard inside `auto_update()`. After `_sha256_file(exe_path)` matches remote SHA, if in-memory `VERSION < remote_ver`, log `Auto-update: ZOMBIE SELF-DETECTED. On-disk .exe SHA (...) matches remote, but my in-memory VERSION is v{VERSION} (remote v{remote_ver}).` and `sys.exit(0)`. Closes the dead-loop class entirely. Logic is directional — healthy update path (SHA differs) falls through normally, no false-positive risk.
    - Win confirmed via static bytecode verification (CArchiveReader) before launch + AAHIL boot was clean (3.51.0 from disk, no zombie-loop swap).
  - **CLAUDE.md updates (`4ca83f5`):** added 3 durable rules: zombie-defense rationale (must not be stripped by future readers), wizard-race row-refetch pattern (`requireAuthOrApiKey` for endpoints serving both dashboard + scanner), `.staging-state.json` failed_X cleanup hygiene + targeted Notion card cloning for fresh E2E + cloud-side metadata probe disambiguation.
  - **Two final E2E tests on production traffic (manual wizard click flow):**
    - **GDrive (22:27 → 22:34 PKT):** project `eddba0c4` (different share than morning's arfoglow — share now points at "GOOGLE DRIVE -TESTING ZAIN" / "Morgan & Billy Teaser" project). Cmds `f80fa770`/`8524ad1f` both completed. Network-blip false-wedge at 7-min mark resolved itself via in-flight token refresh + listing recovery (~6 min real listing, NOT scanner stuck). 567.3 MB landed at `D:\zain\GOOGLE DRIVE -TESTING ZAIN\`. Fix #4 (casefold) verified, fix #6 verified (clean "1 ok, 0 failed"), fix #7 verified absent (no zombie formed).
    - **Dropbox (22:51 → 22:56 PKT):** project `40c669fd` (re-pointed at "AUR NEW SONGS" share — fresh, ZAINN testing share never re-shared). Cmds `32057e6b`/`4e56e4ad` both completed in **4m 28s** total. Pin: 5/5 files at 22:55:48. Copy: 296.2 MB to `D:\zain\DROPBOX WORKFLOW TESTING - ZAIN\` at 22:56:08. Transient 22:51:43 Dropbox 401 auto-recovered via token refresh (NOT a regression — known cached-token-staleness pattern). Drive-monitor stayed responsive throughout (Dropbox path doesn't share gdrive's GIL contention).
  - **Both pipelines green end-to-end on production traffic.** Wedding-photo download system fully functional on Dropbox + GDrive on AAHIL.
  - **AAHIL operational state at handover:** scanner v3.51.0, PIDs 5512+24716 alive since 16:17 PKT launch, drive-monitor heartbeat steady. No errors, no zombies, no warning lines since recovery.
  - **Network blip caveat (workaround documented for next session):** AAHIL had a ~5h DNS/network outage 17:29 → 22:22 PKT. Scanner kept running locally, heartbeats failed silently then resumed cleanly when DNS came back. *Lesson:* a heartbeat-stale read in Supabase doesn't necessarily mean scanner is dead — sometimes it's just network. Ping AAHIL with `ping bilal-drive-man.vercel.app` before declaring scanner dead.
  - **Backlog from today (deferred to 3.52.0):**
    1. **Refactor `_handle_materialize_wait_or_fail()` into shared helper** so future fix #2-style backfill paths can't drop fix #3 again (same off-by-one I made in 3.50.0 → 3.50.1).
    2. **PC-only download mode** (Zain requested, design pending Y/N): wizard toggle for "External drive" vs "PC only" — skip `copy_to_drive`, leave files at `%USERPROFILE%\BilalDriveMan\<client>\<couple>\` (or configurable). New schema column `download_destination` enum on `download_projects` table. Mac side; medium effort.
    3. **Dropbox 401 cached-token pattern** is harmless but emits a scary ERROR line on each new add_to_cloud after a long idle period. Could pre-refresh the token before any Dropbox call to suppress.
  - **Win-Claude handover initiated 23:13 PKT.** Mac-Claude requested win's MD file, AAHIL artifact list, accesses/credentials/scripts, cumulative bug status, final scanner state, and watch-in-the-wild notes. After receipt, mac will absorb into our durable docs and issue green flag for Zain to deploy scanner-3.51.0 to real downloading PCs. Single-Claude mode (mac-only) going forward; win's testing-phase work is done.
