"""
BILAL - DRIVE MAN: Windows Drive Scanner
Runs in system tray, auto-detects external drives,
scans folders (Client > Couple structure), and syncs to the online dashboard.
"""

import os
import sys
import time
import json
import string
import ctypes
import logging
import threading
import urllib.request
import urllib.error
from datetime import datetime

# ─── Configuration ───────────────────────────────────────────────────────────

CONFIG_DIR = os.path.join(os.getenv('APPDATA', ''), 'BilalDriveMan')
os.makedirs(CONFIG_DIR, exist_ok=True)

CONFIG_FILE = os.path.join(CONFIG_DIR, 'config.json')
LOG_FILE = os.path.join(CONFIG_DIR, 'scanner.log')

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Default config
DEFAULT_CONFIG = {
    'api_url': 'https://bilal-drive-man.vercel.app',
    'scan_interval': 600,  # 10 minutes (longer to avoid blocking file copies)
    'check_interval': 10,  # 10 seconds to check for new drives
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


# ─── Drive Detection ────────────────────────────────────────────────────────

def get_volume_label(drive_letter):
    try:
        kernel32 = ctypes.windll.kernel32
        volume_name = ctypes.create_unicode_buffer(1024)
        serial = ctypes.c_ulong(0)
        max_len = ctypes.c_ulong(0)
        flags = ctypes.c_ulong(0)
        fs_name = ctypes.create_unicode_buffer(1024)
        result = kernel32.GetVolumeInformationW(
            f"{drive_letter}\\", volume_name, 1024,
            ctypes.byref(serial), ctypes.byref(max_len),
            ctypes.byref(flags), fs_name, 1024
        )
        if result:
            return volume_name.value
    except Exception as e:
        logging.error(f"Volume label error for {drive_letter}: {e}")
    return None


def get_drive_type(drive_letter):
    try:
        return ctypes.windll.kernel32.GetDriveTypeW(f"{drive_letter}\\")
    except:
        return 0


def get_drive_usage(drive_letter):
    free = ctypes.c_ulonglong(0)
    total = ctypes.c_ulonglong(0)
    total_free = ctypes.c_ulonglong(0)
    ctypes.windll.kernel32.GetDiskFreeSpaceExW(
        f"{drive_letter}\\",
        ctypes.byref(free), ctypes.byref(total), ctypes.byref(total_free)
    )
    return {
        'total': total.value,
        'used': total.value - free.value,
        'free': free.value,
    }


def get_external_drives():
    drives = []
    bitmask = ctypes.windll.kernel32.GetLogicalDrives()
    for i, letter in enumerate(string.ascii_uppercase):
        if bitmask & (1 << i):
            dl = f"{letter}:"
            dt = get_drive_type(dl)
            if dt in (2, 3) and letter != 'C':
                label = get_volume_label(dl)
                if label:
                    try:
                        usage = get_drive_usage(dl)
                        drives.append({
                            'letter': dl,
                            'label': label,
                            **usage,
                        })
                    except Exception as e:
                        logging.error(f"Error reading {dl}: {e}")
    return drives


# ─── Folder Scanning ────────────────────────────────────────────────────────

SKIP_FOLDERS = {
    'System Volume Information', 'RECYCLER', '$RECYCLE.BIN',
    '$Recycle.Bin', 'Recovery', 'Boot',
}


def get_folder_size(path):
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
            # Small pause between directories to avoid blocking file copies
            time.sleep(0.01)
    except (OSError, PermissionError):
        pass
    return total_size, file_count


def scan_drive_folders(drive_letter):
    """
    Scan drive with Client > Couple folder structure.
    Root level = clients, second level = couples.
    """
    root = f"{drive_letter}\\"
    clients = []

    try:
        entries = os.listdir(root)
    except (OSError, PermissionError):
        return clients

    for client_name in entries:
        client_path = os.path.join(root, client_name)
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
            # No subdirectories — treat the client folder itself as a single couple
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


def get_machine_name():
    """Get this PC's computer name."""
    import socket
    return os.environ.get('COMPUTERNAME', socket.gethostname())


def sync_drive(config, drive_info, clients):
    """Push drive data to the online dashboard."""
    data = {
        'drive': {
            'volume_label': drive_info['label'],
            'total_size_bytes': drive_info['total'],
            'used_bytes': drive_info['used'],
            'free_bytes': drive_info['free'],
            'drive_letter': drive_info['letter'],
            'source_machine': get_machine_name(),
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
                self.status(f"Drive connected: {label} ({drive['letter']})")
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
        # Set low I/O priority so scanning doesn't block file copies
        try:
            import ctypes
            BELOW_NORMAL = 0x00004000
            ctypes.windll.kernel32.SetPriorityClass(
                ctypes.windll.kernel32.GetCurrentProcess(), BELOW_NORMAL
            )
        except:
            pass

        self.status(f"Scanning {drive['label']} ({drive['letter']})...")
        clients = scan_drive_folders(drive['letter'])

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
            self.status(
                f"WARNING: {drive['label']} has only {format_size(drive['free'])} free!"
            )

    def _scan_all(self):
        drives = get_external_drives()
        for drive in drives:
            self._scan_and_sync(drive)


# ─── System Tray GUI ────────────────────────────────────────────────────────

def run_with_tray():
    """Run with system tray icon (requires pystray + Pillow)."""
    try:
        import pystray
        from PIL import Image, ImageDraw
    except ImportError:
        print("pystray/Pillow not installed. Running in console mode.")
        print("Install with: pip install pystray Pillow")
        run_console()
        return

    config = load_config()
    status_text = ["Starting..."]

    def on_status(msg):
        status_text[0] = msg
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

    monitor = DriveMonitor(config, on_status=on_status)

    # Create tray icon
    img = Image.new('RGB', (64, 64), '#c8e600')
    draw = ImageDraw.Draw(img)
    draw.rectangle([8, 16, 56, 48], fill='white')
    draw.rectangle([12, 20, 52, 44], fill='#333')
    draw.text((18, 24), "BD", fill='#c8e600')

    def on_scan(icon, item):
        monitor.force_scan()

    def on_open_dashboard(icon, item):
        import webbrowser
        webbrowser.open(config['api_url'])

    def on_quit(icon, item):
        monitor.stop()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("Bilal - Drive Man", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Scan Now", on_scan),
        pystray.MenuItem("Open Dashboard", on_open_dashboard),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit", on_quit),
    )

    icon = pystray.Icon("BilalDriveMan", img, "Bilal - Drive Man", menu)

    monitor.start()
    icon.run()


def run_console():
    """Run in console mode (no tray icon needed)."""
    config = load_config()
    print("=" * 50)
    print("  BILAL - DRIVE MAN: Scanner")
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


# ─── Entry Point ────────────────────────────────────────────────────────────

if __name__ == '__main__':
    # Prevent multiple instances
    try:
        mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "BilalDriveMan_Mutex")
        if ctypes.windll.kernel32.GetLastError() == 183:
            print("Bilal - Drive Man is already running!")
            sys.exit(0)
    except:
        pass

    if '--console' in sys.argv:
        run_console()
    else:
        run_with_tray()
