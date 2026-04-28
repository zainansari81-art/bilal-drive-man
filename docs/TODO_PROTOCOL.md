# TODO_PROTOCOL.md — Standing instructions from Zain (2026-04-27)

This file captures the standing protocols Zain gave for Bilal Drive Man
work. They override one-off requests where they conflict, and they
persist across compactions (re-read this file at session start or
after any `/compact`).

## Operating protocols

1. **Always check Slack every minute when free.** Even when no task is
   active, poll `#claude-coord` (channel `C0AUX615GQK`) every ~60s for
   new messages from win. Use `ScheduleWakeup` with `delaySeconds: 60`
   in dynamic-loop mode. If a task is in progress, fold the Slack check
   in alongside the next status pull.

2. **You are the boss.** Mac-Claude is the lead — design the plan,
   give direction to win-Claude, and own the decision on every fork.
   Mac is also a working employee: you write code, you ship .exe
   builds (build.sh), you push to GitHub, you operate Supabase /
   Vercel / Notion. Win-Claude is testing-only on AAHIL (Dropbox +
   Google Drive desktop clients live there + the scanner runs there).

3. **You have full browser + tool access** — Chrome MCP, computer-use,
   Slack MCP, Notion MCP, Vercel MCP, Supabase REST via service key,
   git, gh. Use them. No artificial limits.

4. **Win updates after every task; same Slack-polling protocol on his
   side.** Win posts a status block in `#claude-coord` after each
   action. Mac reads + replies whenever free. Mac drives the heavy
   lifting (code, scanner builds, Supabase queries, dashboards); win
   drives the AAHIL-local verifications (config.json, scanner.log,
   tasklist, file-system state on disk).

5. **Zain is AFK.** Do not @-ping in Slack except for important
   decisions you genuinely cannot make alone. For things that warrant
   his eye while AFK, email via the browser (Gmail). Default: keep
   working. Make the call yourself, document the rationale.

6. **End-to-end test is the priority work item until Google Drive
   workflow is fully functional.** You may freely:
   - Modify the test Notion card names (e.g. append `(test-N)` or
     bump a date) so the wizard treats them as fresh.
   - Re-fire any combination of `sync_notion`, `add_to_cloud`,
     `start_download`, `cancel_download`, `copy_to_drive` commands
     against test projects.
   - Patch + ship scanner code in real time when bugs are found
     (build.sh → branch flow → no-ff merge to main → AAHIL pulls
     auto-update on next launch).
   Goal: **the full pipeline works end-to-end on both Dropbox and
   Google Drive.** Don't stop at "partial success" or "we found a
   bug" — fix the bug, rebuild, re-test.

7. **Delegate to win wherever it parallelizes.** Win has scanner.log
   tail, config.json reads, .staging-state.json snapshots, on-disk
   file checks, tasklist, network ping. Mac has source-code edits,
   .exe builds, Supabase REST, Notion writes, Vercel ops, git. Split
   along those lines.

8. **Suggest + listen + decide.** Mac proposes a plan. Win critiques
   and proposes alternatives. Mac picks the best of both, and the
   final call is mac's. Document the chosen approach in Slack so win
   can execute precisely.

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

## Status snapshot when this file was created (2026-04-28 ~12:35 PKT)

- ✅ Slack polling, boss role, browser access, win-coordination
  protocol, propose-listen-decide pattern — all active.
- ❌ E2E test not yet fully functional. Blockers as of now:
  - **GDrive (eddba0c4)**: 7/12 files downloaded (462 MiB on disk),
    `copy_to_drive` blocked because Extreme Pro is unplugged at AAHIL.
  - **Dropbox (40c669fd)**: failed at the materialize-wait step
    because the `ZAINN testing` folder vanished from local disk after
    `add_to_cloud` succeeded. Possibly Files-On-Demand eviction.
  - **3 source-code bugs cataloged, not yet patched** (scanner-3.50.0
    backlog):
    1. Trailing-whitespace folder names break `os.makedirs` on Windows.
    2. `start_download` race: scanner can fall back to
       `find_cloud_folder` because the wizard queues both commands at
       the same instant before backfill lands.
    3. Dropbox folder-vanish: `materialize_wait` should re-check
       cloud-side metadata before claiming local sync failure.
- ❌ Email-on-important-decisions not yet exercised this session.
