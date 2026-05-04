# Bilal Drive Man — Live Walkthrough

**Open the portal in another tab and follow along step-by-step.**

URL: **https://bilal-drive-man.vercel.app**

(Login with the credentials Zain shared. Once logged in, take 5 minutes and walk through the 6 sections below.)

---

## Section 1 — The sidebar (left rail)

After login you land on the **Dashboard**. The dark left-rail sidebar shows 6 icons:

```
 ▢  Dashboard       ← drive overview, summary stats
 🗄️ Drives           ← every external + cloud drive the system has ever seen
 💻 Devices          ← computers running the scanner (e.g. DOWNLOADING-PRO)
 ⬇  Downloading-Pro  ← THIS IS WHERE YOU'LL LIVE 90% OF THE TIME
 🔍 Search           ← find a couple by name
 ⏱  History          ← past sync events + activity log
```

The yellow-highlighted item is "Downloading-Pro" — that's the one for managing actual download orders. **Click it.**

---

## Section 2 — Downloading-Pro page (your daily driver)

You'll see **5 stat cards** at the top:

| Card | What it counts |
|---|---|
| **Total** | Every project in the system |
| **Not Downloaded** | Waiting — these are jobs you can fire |
| **Active** | Currently in flight (downloading, copying, queued, paused) |
| **Downloaded** | Completed — files are on the external drive |
| **Failed** | Needs attention — click to investigate |

**Click any card** — the project list below filters to just that bucket. Click again (or click "Total") to clear the filter.

Below the cards is a **green "Sync from Notion" button**. Click it whenever you want to pull the latest project data from Notion. Auto-syncs every 5 min anyway, but click it for instant freshness.

Below that is the **project table**. Each row has:
- **Project** — the couple/event name (click the ▶ arrow on the left to expand)
- **Client** — photographer / company who owns this project
- **Date** — wedding/event date
- **Status** — colored badge showing current state
- **Queue** — position in the download queue (only filled when status = Queued)
- **Actions** — buttons that appear depending on status (Download, Pause, Cancel, Resume, Retry)

### Status badges and what they mean

| Badge color | Meaning | What action is available |
|---|---|---|
| `Not Downloaded` (amber) | Waiting to be fired | Click to expand → click **Download** button |
| `Queued` (yellow) | Waiting its turn behind another active download | Auto-starts when current job finishes |
| `Downloading` (blue) | Pulling files from cloud | Pause / Cancel buttons available |
| `Copying to <drive>` (purple) | Downloaded, copying to external drive now | (in flight, just wait) |
| `Copied to <drive>` (green) | DONE — files are on the drive | (no action — complete) |
| `Paused` (gray) | User-paused mid-download | Click **Resume** to continue |
| `Failed` (red) | Error — read the message | Click **Resume** (auto-retry) or expand for details |

---

## Section 3 — Firing a download (most common task)

1. Find the project in the **Not Downloaded** list (or click the Not Downloaded stat card to filter).
2. Click the **▶ arrow** on the left of the row → row expands and shows a **Download** button.
3. Click **Download**. A 2-step wizard pops up:

   **Step 1 — Confirm the link**
   Wizard pre-fills the download link (Dropbox / GDrive / WeTransfer URL from Notion). If it's wrong, edit and click Next.

   **Step 2 — Pick where it goes**
   - **Machine:** dropdown — select **DOWNLOADING-PRO** (always, unless told otherwise)
   - **Target Drive:** dropdown — pick the external drive currently plugged in (Florida2, Hawaii 4tb, etc.). The dropdown only shows currently-connected drives.
   - **Cloud Account:** usually leave on "Auto (PC default)" — ignore this unless Zain told you otherwise.

4. Click **Start Download**.
5. Modal closes. Project's badge flips to **Queued** or **Downloading**.

You're done — system handles the rest. Files will land on the external drive at `<Drive>:\<client_name>\<couple_name>\` automatically.

**Realistic timing:** 1 GB takes ~2-3 min on a normal connection. 10 GB ~20 min. 100 GB ~3-4 hours. Watch the progress bar (visible when the row is expanded).

---

## Section 4 — When something goes wrong

A red **Failed** badge means something broke. Click the row to expand — the error message appears in red right under the project title.

**Top 3 errors you'll see and exactly what to do:**

### Error: "Cloud folder ... no longer present in Dropbox"
The shared folder vanished from Dropbox. Either the original sender deleted it, unshared it, or Dropbox glitched.
**Fix:**
1. Email or Slack the original sender, ask them to re-share the folder
2. Once re-shared, click **Resume** (or re-fire from the wizard). It'll work this time.

### Error: "Target drive not found: <drive name>"
The external drive isn't plugged into DOWNLOADING-PRO right now.
**Fix:**
1. Check DOWNLOADING-PRO physically — is the drive plugged in?
2. Wait ~30 seconds for the scanner to detect it
3. Refresh the dashboard, click **Resume**

### Error: "getaddrinfo failed" / "network" / "connection timeout"
DOWNLOADING-PRO's internet was down during the download.
**Fix:**
1. Check the **Devices** tab — is DOWNLOADING-PRO's "Last seen" recent (within last 60s)? If not, scanner is offline; investigate the PC.
2. If scanner is online, just click **Resume** — already-synced files skip; only the missing ones download.

For ANY error message that doesn't match the patterns in `HANDOVER_OPS.md` — copy the exact text and email Zain.

---

## Section 5 — Drives page (NEW: Ignore Permanently)

Click **Drives** in the sidebar. You'll see two sections:

```
Connected (3)         ← drives currently plugged in somewhere
  ▶ Florida2 2        2.10 TB used / 1.82 TB · 95% · 25C / 68Cp · Connected (D:)   [Ignore Permanently]
  ▶ Hawaii 4tb        ...                                                          [Ignore Permanently]
  ▶ Newyork 4tb       ...                                                          [Ignore Permanently]

Disconnected (16)     ← drives not plugged in but still tracked
  ▶ Cali 4tb          ...                                                          [Ignore Permanently]
  ▶ ... (etc)
```

**The "Ignore Permanently" button** (right side of each row) is new as of 2026-05-04. Use it when:
- A weird drive shows up that isn't a real wedding-photo drive (camera SD cards, software installer DMGs, virtual mounts, etc.)
- You see something like `EOS_DIGITAL`, `Codex Installer`, `19045-6456_x64_MUI`, or a Windows ISO mount

Click → confirm dialog → drive disappears forever from the dashboard. (The scanner still detects it physically — only the display is hidden.)

**To un-ignore:** there's no UI for this yet. Email Zain — it's a one-line database flip.

---

## Section 6 — Devices page (scanner health)

Click **Devices** in the sidebar. You'll see one row per machine running a scanner:

```
DOWNLOADING-PRO   • Last seen: 2 min ago   • download PC   • 0 active downloads
```

**What to check daily:**
- **Last seen** — should always be within the last 60 seconds. If it's older than 5 minutes, the scanner on DOWNLOADING-PRO is stuck or offline.
- If stuck: go to DOWNLOADING-PRO, open PowerShell (right-click Start menu → "Windows PowerShell"), and run:
  ```powershell
  Start-ScheduledTask -TaskName "BilalDriveManScanner"
  ```
  Wait 30 seconds, refresh the Devices page. "Last seen" should update.

---

## Section 7 — Common scenarios cheat sheet

| Situation | What to do |
|---|---|
| New project from photographer just dropped in Notion | Click **Sync from Notion** in Downloading-Pro page → wait 30s → it appears in Not Downloaded list → fire as normal |
| Two projects need to download to same drive | Fire both — second one auto-queues. No action needed. |
| Drive ran out of space mid-copy | Project flips to Failed with disk-full message. Plug in a fresh drive, click Resume. |
| Photographer asks "is X downloaded yet?" | Search bar at top (or click Search icon). Type couple name. Status badge shows current state. |
| Heartbeat shows "stale 5h ago" but scanner.log on PC is heartbeating fine | Network blip on the PC's side. Wait 5 min and re-check before doing anything. |
| Multiple BilalDriveMan-Scanner.exe processes running on DOWNLOADING-PRO | Old artifact — should never happen with the auto-restart Task Scheduler config. If you see it, open Task Manager, kill the older PIDs (smaller PID = older), Task Scheduler will keep one alive. |

---

## Final notes

- **Do NOT delete** any project from the portal directly — they're synced from Notion. Delete in Notion if needed; portal will follow on next sync.
- **Do NOT change** scanner config files on DOWNLOADING-PRO unless Zain instructs you. The system is set up to self-heal.
- **DO read** `HANDOVER_OPS.md` (the printable PDF version `HANDOVER_OPS.pdf`) — it has the same info plus deeper escalation patterns.
- When in doubt: click **Sync from Notion**, then wait 30s and look again. 80% of "weird states" resolve themselves on next sync.

---

**Reach out to Zain at zainansari0340@gmail.com for anything that doesn't match a pattern above.** No question is too small.
