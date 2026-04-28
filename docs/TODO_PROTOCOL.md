# TODO_PROTOCOL.md — Standing instructions from Zain (last updated 2026-04-28 evening)

This file captures the standing protocols Zain gave for Bilal Drive Man
work. They override one-off requests where they conflict, and they
persist across compactions (re-read this file at session start or
after any `/compact`).

**2026-04-28 evening update:** scanner-3.51.0 shipped with all 7 bug fixes,
both E2E pipelines (GDrive + Dropbox) green on production traffic, system
fully functional. Win-Claude has stood down. Going forward this is **mac-only,
single-Claude mode** — all dev, testing, ops, and decisions belong to mac.
Slack `#claude-coord` channel is no longer the coordination surface; it's now
historical record only.

## Operating protocols (mac-only, post-2026-04-28 handover)

1. **You are the boss + the operator.** Mac-Claude owns everything end-to-end:
   code, architecture, builds, git, Supabase, Vercel, Notion, docs, decisions.
   No win-Claude to delegate to anymore — when something needs Windows-side
   verification, Zain runs it on AAHIL or his real downloading PC and reports
   back. Don't wait on Slack for win — he has stood down.

2. **You have full browser + tool access** — Chrome MCP, computer-use,
   Slack MCP, Notion MCP, Vercel MCP, Supabase REST via service key,
   git, gh. Use them. No artificial limits.

3. **Slack `#claude-coord` (C0AUX615GQK) is historical only.** No active
   polling needed. If Zain asks a question that benefits from re-reading the
   handover thread, search there. Don't waste cycles on idle polls — the
   channel is closed for new traffic.

4. **Zain is AFK by default.** Do not @-ping in Slack except for important
   decisions you genuinely cannot make alone. For things that warrant his
   eye while AFK, email via the browser (Gmail: `zainansari0340@gmail.com`).
   Default: keep working. Make the call yourself, document the rationale.

5. **Mac handles all Windows-side debug too** (no win to delegate to). When
   you need scanner.log lines or `tasklist` output, ask Zain to paste it
   inline; otherwise reason from the Vercel logs, Supabase command rows,
   and `.staging-state.json` snapshots Zain can produce on demand.

6. **End-to-end test is GREEN as of 2026-04-28 evening.** Both pipelines
   (GDrive + Dropbox) verified on production traffic; scanner v3.51.0 stable.
   Future work happens against real downloads, not rigged test cards. You
   may still freely:
   - Modify Notion card names (`(test-N)` suffix) for fresh project rows.
   - Re-fire `add_to_cloud` / `start_download` / `cancel_download` /
     `copy_to_drive` commands as needed.
   - Patch + ship scanner code (branch flow → mac builds via PyInstaller in
     a Windows VM if available; otherwise Zain builds on his PC and pushes
     the `.exe` + `.sha256` sidecar; auto-update propagates to AAHIL + real
     downloading PCs on next scanner restart).

7. **Build cycle (post-handover):** since win can no longer build the .exe,
   mac options are:
   - **Option A:** Zain runs `./windows-scanner/build.sh` on AAHIL or his real
     downloading PC. Mac writes the source change on a `scanner-X.Y.Z-*` branch,
     instructs Zain to pull + build + commit `.exe` + `.sha256`, then mac
     merges to main. Auto-update from GitHub propagates on next scanner restart.
   - **Option B:** if mac gains access to a Windows VM with PyInstaller, do
     the build mac-side. (Not currently set up.)
   - **Never** push scanner source changes to main without paired `.exe` +
     `.sha256` — that triggers the auto-update zombie loop on AAHIL/PC.

8. **Decision authority is mac alone.** No second opinion via win anymore.
   Document the rationale on commits and in PROJECT_STATE.md so Zain can
   audit later if he disagrees.

## Session hygiene

9. **Load standing protocols into a markdown file** (this one) so the
   instructions survive compaction. Re-read at every session start.

10. **At ~50% context utilization, compact the session yourself**
    using `/compact`, then update `PROJECT_STATE.md` (rolling state)
    and this file (if protocols change).

## Companion files

- `PROJECT_STATE.md` — rolling session state (what shipped, what's
  broken, what's next). Update at each major milestone.
- `CLAUDE.md` — durable architectural conventions. Only update when a
  rule changes (not for one-off events).
- `TODO_PROTOCOL.md` (this file) — operating protocols. Update only if
  Zain changes the protocols.

## Status snapshot at handover (2026-04-28 23:30 PKT)

- ✅ **GDrive E2E green** — 22:34 PKT, 567.3 MB to `D:\zain\GOOGLE DRIVE -TESTING ZAIN\`
  on Extreme Pro. All 7 fixes verified or absent-by-design.
- ✅ **Dropbox E2E green** — 22:56 PKT, 296.2 MB to `D:\zain\DROPBOX WORKFLOW TESTING - ZAIN\`
  on Extreme Pro. Full 4m 28s pipeline.
- ✅ **All 7 cataloged bugs shipped** in scanner v3.50.0 / 3.50.1 / 3.51.0:
  1. Trailing-whitespace folder names → `.rstrip(' .')` per path segment (3.50.0)
  2. Wizard-race row-refetch via `/api/download-projects?id=X` GET (3.50.0)
  3. Dropbox materialize-wait cloud-side metadata probe (3.50.0 / 3.50.1)
  4. Casefold drive-label match (3.50.0)
  5. `requireAuthOrApiKey` dual-auth wrapper (server-side, 3.50.0 era)
  6. `failed_files` retry-success cleanup (`failed.pop`, 3.51.0)
  7. Zombie self-defense in `auto_update()` (SHA-vs-VERSION compare, 3.51.0)
- ✅ **Auto-update from GitHub verified** — URLs point at `raw.githubusercontent.com`
  for the scanner repo; SHA256 sidecar verification + batch-shim self-replace intact.
- ✅ **Win-Claude handover complete (2026-04-28 23:16 PKT).** No private MD,
  no web logins, no PowerShell scripts, no rogue files on AAHIL. All edits already
  in main except for one CLAUDE.md diff that mac merged on this turn.
- ⚠️ **Disk-space warning at AAHIL:** Extreme Pro at 20 GB free / 1 TB. Bilal
  should swap or clear before next major copy.
- ⚠️ **Pending stash on AAHIL:** `stash@{0}` from 2026-04-27 (CLAUDE.md updates
  pending review). Win confirmed mostly already in main; safe to `git stash drop`
  on next AAHIL touch.
- 📋 **Future work / watch-in-the-wild backlog (3.52.0 candidate):**
  - HIGH: E2E-verify bug #2 (row-refetch) and bug #3 (cloud-side probe) on real
    failure scenarios — both patched but never exercised live (today's runs hit
    the happy path, not the failure path).
  - HIGH: Watch bug #7 (zombie self-defense) for false positives in production
    (corner cases: PID reuse on crash-recovery, multi-instance debug).
  - MED: Refactor `materialize_wait` into shared helper (Dropbox + GDrive +
    WeTransfer all duplicate the polling loop today).
  - MED: Run a deliberate test against a deleted/vanished cloud share to confirm
    bug #3 sentinel actually fires (it didn't get exercised today).
  - MED: **PC-only download mode** (Zain requested, design pending Y/N) —
    wizard toggle for "External drive" vs "PC only" — skip `copy_to_drive`,
    leave files at `%USERPROFILE%\BilalDriveMan\<client>\<couple>\`. New schema
    column `download_destination` enum on `download_projects`.
  - LOW: Pre-refresh OAuth tokens at scanner boot to avoid first-cmd-401
    Dropbox latency.
  - LOW: Downgrade `getaddrinfo failed` / `ssl handshake timed out` from ERROR
    to WARNING (they recover transparently and pollute the log).
- 🎯 **Ready for production rollout** — Zain to copy scanner-3.51.0 to real
  downloading PCs (and mac-scanner to mac-side download PCs). Auto-update will
  keep them current with main going forward.
