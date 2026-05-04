# Bilal Drive Man — Operations Cheat Sheet

**For the person managing day-to-day downloads.**
Last updated: 2026-05-04 (handover from Zain).

## What this system does

The portal at **https://bilal-drive-man.vercel.app** is the dashboard for managing wedding-photo / video deliveries. Photographers/clients send links (Dropbox, Google Drive, WeTransfer); a Windows scanner running on `DOWNLOADING-PRO` downloads them to that PC's cloud folders, then copies the result to a connected external hard drive (Florida2, Hawaii 4tb, etc.).

## Daily routine

1. **Open https://bilal-drive-man.vercel.app/#downloading** and log in (Zain has the password).
2. Look at the four stat cards at the top:
   - **Not Downloaded** — projects waiting to be started
   - **Active** — currently downloading / copying / queued / paused
   - **Downloaded** — completed (files on the external drive)
   - **Failed** — needs manual attention
3. Click **Sync from Notion** if you don't see new projects. Notion is the source of truth for which projects exist and their status.

## Firing a download

1. Click any project in the **Not Downloaded** list, OR find it in the table.
2. Click the **Download** button. The wizard opens.
3. **Step 1:** confirm the download link is correct (Dropbox / Google Drive / WeTransfer). If wrong, edit it.
4. **Step 2:** pick the **machine** (always `DOWNLOADING-PRO` unless told otherwise) and the **target external drive** (Florida2, Hawaii, etc. — must be physically plugged into DOWNLOADING-PRO at the time).
5. Click **Start Download**.
6. The status badge will flip:
   - `Queued` (yellow) — if scanner is busy with another job, this one waits its turn
   - `Downloading` (blue) — actively pulling files
   - `Copying to <drive name>` (purple) — files done, copying to external drive
   - `Copied to <drive name>` (green) — DONE, files are on the drive

## When something fails

If a project shows `Failed` (red badge):

1. Click it to expand. The error message is shown right under the title.
2. Common error patterns + fixes:

| Error message contains... | What it means | Fix |
|---|---|---|
| `Cloud folder ... no longer present in Dropbox` | The shared folder vanished from Dropbox | Ask the original sender to re-share the folder, then re-fire from the wizard |
| `Target drive not found` | The external drive isn't plugged into DOWNLOADING-PRO | Plug the drive in, wait 30s for the scanner to detect it, then click **Resume** on the project |
| `getaddrinfo failed` / `network` | Internet was down during the download | Click **Resume** — already-synced files will skip; only the missing ones download |
| `Exceeded resume attempts` | The system tried 3 times and gave up | Look at scanner.log on DOWNLOADING-PRO for the underlying issue, OR ask Zain |
| `path traversal` / `permission` | A weird filename couldn't be created on Windows | Note the project, ask Zain — usually requires renaming the source folder |

## Drives panel

The **Drives** tab (left sidebar) shows every external drive the system has ever seen.

- **Connected (green)** — physically plugged in right now, scanner is using its data
- **Disconnected (red)** — not plugged in; their data is preserved but operations against them will fail
- **"Ignore Permanently" button** — click this on any drive you don't want to see (e.g. Codex Installer, Google Drive virtual mount, Windows ISO mounts, camera SD cards). It hides the drive from this list, the wizard, and stat counts forever. Scanner still detects it; only the display is affected. Un-ignoring requires Zain to flip a database column.

## DOWNLOADING-PRO Windows machine

The scanner runs as a Windows Task Scheduler task on the PC named **DOWNLOADING-PRO**. It auto-starts on every login, auto-restarts within 1 minute if it crashes, and self-updates from GitHub every ~5 minutes.

**To check if scanner is alive on the PC** (open PowerShell):
```powershell
Get-Process -Name "BilalDriveMan-Scanner" -ErrorAction SilentlyContinue
```
Should show 1-2 rows. If empty, manually relaunch:
```powershell
Start-ScheduledTask -TaskName "BilalDriveManScanner"
```

**To see what it's doing** (last 30 log lines):
```powershell
Get-Content "$env:APPDATA\BilalDriveMan\scanner.log" -Tail 30
```

## Notion ↔ Portal sync

The portal automatically syncs with Notion every 5 minutes:
- New projects added to Notion appear in the portal
- Status changes (e.g. marking a project "Delivered" in Notion) flow back to the portal
- The portal also writes status updates to Notion when downloads progress

**Mapping:**
| Notion status | Portal status |
|---|---|
| Not Downloaded | idle |
| Approved | idle (ready to fire) |
| Downloading / In Progress | downloading |
| Copying | copying |
| Downloaded / Delivered / Success | completed |
| Failed | failed |
| Cancelled | idle |

If a project's status looks wrong, click **Sync from Notion** in the portal — Notion is the source of truth.

## Things to watch

- **Disk space on external drives** — keep an eye on the "Free" column in the Drives tab. When a drive drops below 100 GB free, it will show a yellow warning. Below 20 GB, swap to a different drive before starting any new big download.
- **Heartbeat freshness** — go to the Devices tab. DOWNLOADING-PRO should show "Last seen" within the last 60 seconds. If it's older than 5 minutes, the scanner may be stuck — try the Get-Process check above.
- **Stuck "Downloading" projects** — if a project sits in `downloading` status for more than ~30 minutes without progress, click it to expand and look at the error / progress bar. May need a Resume click or manual investigation.

## Limits

- Only **one** download runs at a time per machine. Additional downloads go into a **Queued** state and start automatically when the current one finishes.
- WeTransfer links expire after ~7 days from share creation; if you see "transfer expired" errors, ask the sender for a fresh link.
- The system can't recover files that the original sender deleted from cloud. Once the source is gone, that's it.

## Escalation

For anything you don't recognize:
- **Zain:** zainansari0340@gmail.com (or via Slack DM)
- **GitHub repo (read-only useful for code questions):** https://github.com/zainansari81-art/bilal-drive-man

When asking for help, include:
1. The project name (couple name) showing the issue
2. The error message text from the portal
3. (If you can) the last 20 lines from `%APPDATA%\BilalDriveMan\scanner.log` on DOWNLOADING-PRO
