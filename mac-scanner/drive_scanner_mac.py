"""
BILAL - DRIVE MAN: Mac Drive Scanner
Runs in the background, detects external drives on macOS,
scans folders (Client > Couple structure), and syncs to the online dashboard.
"""

import os
import sys
import time
import json
import subprocess
import logging
import threading
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

# ─── Configuration ───────────────────────────────────────────────────────────

CONFIG_DIR = os.path.expanduser('~/Library/Application Support/BilalDriveMan')
os.makedirs(CONFIG_DIR, exist_ok=True)

CONFIG_FILE = os.path.join(CONFIG_DIR, 'config.json')
LOG_FILE = os.path.join(CONFIG_DIR, 'scanner.log')

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

DEFAULT_CONFIG = {
    'api_url': 'https://bilal-drive-man.vercel.app',
    'scan_interval': 300,
    'check_interval': 10,
    'low_space_gb': 100,
}


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                return {**DEFAULT_CONFIG, **json.load(f)}
        except:
            pass
    save_config(DEFAULT_CONFIG)
    return DEFAULT_CONFIG.copy()


def save_config(config):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)


# ─── macOS Drive Detection ──────────────────────────────────────────────────

def get_external_drives():
    """Detect external drives on macOS via /Volumes."""
    drives = []
    volumes_path = '/Volumes'

    try:
        entries = os.listdir(volumes_path)
    except OSError:
        return drives

    for name in entries:
        vol_path = os.path.join(volumes_path, name)
        if not os.path.ismount(vol_path):
            continue

        # Skip the boot volume
        if vol_path == '/' or name == 'Macintosh HD' or name == 'Macintosh HD - Data':
            continue

        try:
            stat = os.statvfs(vol_path)
            total = stat.f_frsize * stat.f_blocks
            free = stat.f_frsize * stat.f_bavail
            used = total - free

            # Skip tiny volumes (< 1GB) - likely system partitions
            if total < 1_000_000_000:
                continue

            drives.append({
                'path': vol_path,
                'label': name,
                'total': total,
                'used': used,
                'free': free,
            })
        except OSError as e:
            logging.error(f"Error reading volume {name}: {e}")

    return drives


# ─── Folder Scanning ────────────────────────────────────────────────────────

SKIP_FOLDERS = {
    '.Spotlight-V100', '.fseventsd', '.Trashes', '.TemporaryItems',
    '.DocumentRevisions-V100', '.VolumeIcon.icns', '.DS_Store',
    'System Volume Information', '$RECYCLE.BIN', '.metadata_never_index',
}


def get_folder_size(path):
    """Calculate total size and file count of a folder."""
    total_size = 0
    file_count = 0
    try:
        for dirpath, _, filenames in os.walk(path):
            for f in filenames:
                try:
                    fp = os.path.join(dirpath, f)
                    if not os.path.islink(fp):
                        total_size += os.path.getsize(fp)
                        file_count += 1
                except (OSError, PermissionError):
                    pass
    except (OSError, PermissionError):
        pass
    return total_size, file_count


def scan_drive_folders(drive_path):
    """
    Scan drive with Client > Couple folder structure.
    Root level = clients, second level = couples.
    """
    clients = []

    try:
        entries = os.listdir(drive_path)
    except (OSError, PermissionError):
        return clients

    for client_name in entries:
        client_path = os.path.join(drive_path, client_name)
        if not os.path.isdir(client_path):
            continue
        if client_name.startswith('.') or client_name.startswith('$') or client_name in SKIP_FOLDERS:
            continue

        couples = []
        try:
            sub_entries = os.listdir(client_path)
        except (OSError, PermissionError):
            sub_entries = []

        has_subdirs = False
        for couple_name in sub_entries:
            couple_path = os.path.join(client_path, couple_name)
            if os.path.isdir(couple_path):
                if couple_name.startswith('.') or couple_name.startswith('$'):
                    continue
                has_subdirs = True
                size, file_count = get_folder_size(couple_path)
                couples.append({
                    'name': couple_name,
                    'size': size,
                    'file_count': file_count,
                })

        if not has_subdirs:
            size, file_count = get_folder_size(client_path)
            couples.append({
                'name': client_name,
                'size': size,
                'file_count': file_count,
            })

        clients.append({
            'name': client_name,
            'couples': couples,
        })

    return clients


# ─── API Sync ───────────────────────────────────────────────────────────────

API_KEY = 'bilal-scanner-key-2024'


def api_request(config, endpoint, data):
    url = f"{config['api_url']}/api/{endpoint}"
    body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('x-api-key', API_KEY)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ''
        logging.error(f"API error {e.code} for {endpoint}: {err_body}")
        return None
    except Exception as e:
        logging.error(f"API request failed for {endpoint}: {e}")
        return None


def sync_drive(config, drive_info, clients):
    data = {
        'drive': {
            'volume_label': drive_info['label'],
            'total_size_bytes': drive_info['total'],
            'used_bytes': drive_info['used'],
            'free_bytes': drive_info['free'],
            'drive_letter': drive_info.get('path', ''),
        },
        'clients': clients,
    }

    result = api_request(config, 'sync', data)
    if result and result.get('success'):
        stats = result.get('stats', {})
        logging.info(
            f"Synced {drive_info['label']}: "
            f"+{stats.get('foldersAdded', 0)} added, "
            f"~{stats.get('foldersUpdated', 0)} updated, "
            f"-{stats.get('foldersRemoved', 0)} removed"
        )
        return True
    return False


def disconnect_drive(config, volume_label):
    result = api_request(config, 'disconnect', {'volume_label': volume_label})
    if result and result.get('success'):
        logging.info(f"Marked {volume_label} as disconnected")


# ─── Format Helpers ─────────────────────────────────────────────────────────

def format_size(size_bytes):
    if size_bytes == 0:
        return "0 B"
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    i = 0
    size = float(size_bytes)
    while size >= 1024 and i < len(units) - 1:
        size /= 1024
        i += 1
    return f"{size:.1f} {units[i]}"


# ─── Drive Monitor ──────────────────────────────────────────────────────────

class DriveMonitor:
    def __init__(self, config, on_status=None):
        self.config = config
        self.running = False
        self.known_drives = {}
        self.last_scan = {}
        self.on_status = on_status

    def status(self, msg):
        logging.info(msg)
        if self.on_status:
            self.on_status(msg)

    def start(self):
        self.running = True
        threading.Thread(target=self._loop, daemon=True).start()
        self.status("Drive monitor started")

    def stop(self):
        self.running = False

    def force_scan(self):
        threading.Thread(target=self._scan_all, daemon=True).start()

    def _loop(self):
        while self.running:
            try:
                self._check()
            except Exception as e:
                logging.error(f"Monitor error: {e}")
            time.sleep(self.config.get('check_interval', 10))

    def _check(self):
        current = get_external_drives()
        current_labels = {d['label']: d for d in current}

        # New drives
        for drive in current:
            label = drive['label']
            if label not in self.known_drives:
                self.status(f"Drive connected: {label} ({drive['path']})")
                self._scan_and_sync(drive)

        # Disconnected drives
        for label in list(self.known_drives.keys()):
            if label not in current_labels:
                self.status(f"Drive disconnected: {label}")
                disconnect_drive(self.config, label)

        # Periodic rescan
        for drive in current:
            last = self.last_scan.get(drive['label'], 0)
            if time.time() - last > self.config.get('scan_interval', 300):
                self._scan_and_sync(drive)

        self.known_drives = current_labels

    def _scan_and_sync(self, drive):
        self.status(f"Scanning {drive['label']} ({drive['path']})...")
        clients = scan_drive_folders(drive['path'])

        total_couples = sum(len(c['couples']) for c in clients)
        self.status(f"Found {len(clients)} clients, {total_couples} couples on {drive['label']}")

        self.status(f"Syncing {drive['label']} to dashboard...")
        success = sync_drive(self.config, drive, clients)

        if success:
            self.status(f"Synced {drive['label']} successfully")
        else:
            self.status(f"Failed to sync {drive['label']} - will retry")

        self.last_scan[drive['label']] = time.time()

        # Low space warning
        threshold = self.config.get('low_space_gb', 100) * 1024**3
        if drive['free'] < threshold:
            self.status(f"WARNING: {drive['label']} has only {format_size(drive['free'])} free!")
            try:
                os.system(f'osascript -e \'display notification "{drive["label"]} has only {format_size(drive["free"])} free!" with title "Bilal - Drive Man" subtitle "Low Space Warning"\'')
            except:
                pass

    def _scan_all(self):
        drives = get_external_drives()
        for drive in drives:
            self._scan_and_sync(drive)


# ─── macOS Menu Bar App ────────────────────────────────────────────────────

def run_menubar():
    """Run as macOS menu bar app using rumps."""
    try:
        import rumps
    except ImportError:
        print("rumps not installed. Running in console mode.")
        print("Install with: pip3 install rumps")
        run_console()
        return

    config = load_config()

    class BilalDriveManApp(rumps.App):
        def __init__(self):
            super().__init__("Bilal - Drive Man", icon=None, title="BD")
            self.monitor = DriveMonitor(config, on_status=self._on_status)
            self.status_item = rumps.MenuItem("Status: Starting...")
            self.status_item.set_callback(None)
            self.menu = [
                self.status_item,
                None,
                rumps.MenuItem("Scan Now", callback=self._scan_now),
                rumps.MenuItem("Open Dashboard", callback=self._open_dashboard),
                None,
                rumps.MenuItem("View Log", callback=self._view_log),
            ]
            # Start monitor after app launches
            rumps.Timer(self._start_monitor, 1).start()

        def _start_monitor(self, _):
            if not self.monitor.running:
                self.monitor.start()

        def _on_status(self, msg):
            timestamp = datetime.now().strftime('%H:%M:%S')
            self.status_item.title = f"[{timestamp}] {msg}"

        def _scan_now(self, _):
            self.monitor.force_scan()
            rumps.notification(
                "Bilal - Drive Man",
                "Scanning...",
                "Scanning all connected drives"
            )

        def _open_dashboard(self, _):
            import webbrowser
            webbrowser.open(config['api_url'])

        def _view_log(self, _):
            os.system(f'open "{LOG_FILE}"')

    app = BilalDriveManApp()
    app.run()


def run_console():
    """Run in console mode (no menu bar)."""
    config = load_config()
    print("=" * 50)
    print("  BILAL - DRIVE MAN: Mac Scanner")
    print(f"  Syncing to: {config['api_url']}")
    print("=" * 50)
    print()

    def on_status(msg):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

    monitor = DriveMonitor(config, on_status=on_status)
    monitor.start()

    try:
        while True:
            cmd = input("\nCommands: [s]can now, [d]ashboard, [q]uit > ").strip().lower()
            if cmd == 's':
                monitor.force_scan()
            elif cmd == 'd':
                import webbrowser
                webbrowser.open(config['api_url'])
            elif cmd == 'q':
                monitor.stop()
                break
    except KeyboardInterrupt:
        monitor.stop()
        print("\nStopped.")


# ─── Launch Agent (Auto-Start) ──────────────────────────────────────────────

def install_launchagent():
    """Install as a macOS Launch Agent so it starts on login."""
    plist_dir = os.path.expanduser('~/Library/LaunchAgents')
    os.makedirs(plist_dir, exist_ok=True)

    script_path = os.path.abspath(__file__)
    plist_path = os.path.join(plist_dir, 'com.bilaldriveman.scanner.plist')

    plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bilaldriveman.scanner</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>{script_path}</string>
        <string>--console</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>{LOG_FILE}</string>
</dict>
</plist>"""

    with open(plist_path, 'w') as f:
        f.write(plist_content)

    os.system(f'launchctl load "{plist_path}"')
    print(f"Launch Agent installed at: {plist_path}")
    print("Scanner will now start automatically on login.")
    print(f"To uninstall: launchctl unload \"{plist_path}\" && rm \"{plist_path}\"")


# ─── Entry Point ────────────────────────────────────────────────────────────

if __name__ == '__main__':
    if '--install' in sys.argv:
        install_launchagent()
    elif '--console' in sys.argv:
        run_console()
    else:
        run_menubar()
