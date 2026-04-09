"""
Mac Scanner V.3.36.0 - BILAL DRIVE MAN
Runs in the background, detects external drives on macOS,
scans folders (Client > Couple structure), and syncs to the online dashboard.
"""

VERSION = '3.41.0'

import os
import sys
import time
import json
import ssl
import subprocess
import logging
import threading
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime

# Fix SSL certificate verification on macOS
try:
    import certifi
    ssl._create_default_https_context = lambda: ssl.create_default_context(cafile=certifi.where())
except ImportError:
    logging.warning("certifi not installed — using system SSL certificates. Install with: pip3 install certifi")
    # Don't disable SSL verification — use system defaults instead
from pathlib import Path

# ─── Auto-Update ─────────────────────────────────────────────────────────────

GITHUB_RAW_URL = 'https://raw.githubusercontent.com/zainansari81-art/bilal-drive-man/main/mac-scanner/drive_scanner_mac.py'

def auto_update():
    """Check GitHub for newer version and replace self if updated."""
    try:
        script_path = os.path.abspath(__file__)
        with open(script_path, 'r') as f:
            current = f.read()

        # Add timestamp to bust GitHub raw CDN cache
        cache_bust_url = f"{GITHUB_RAW_URL}?t={int(time.time())}"
        req = urllib.request.Request(cache_bust_url)
        req.add_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        req.add_header('Pragma', 'no-cache')
        with urllib.request.urlopen(req, timeout=15) as resp:
            latest = resp.read().decode('utf-8')

        if latest.strip() != current.strip() and len(latest) > 100:
            with open(script_path, 'w') as f:
                f.write(latest)
            print("[AUTO-UPDATE] Updated to latest version. Restarting...")
            logging.info("Auto-updated from GitHub. Restarting...")
            os.execv(sys.executable, [sys.executable] + sys.argv)
        else:
            logging.info("Auto-update check: already up to date")
    except Exception as e:
        logging.error(f"Auto-update check failed (will retry next start): {e}")

auto_update()

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

def _get_internal_volume_names():
    """Use diskutil to find internal volume names so we can skip them."""
    internal = set()
    try:
        result = subprocess.run(
            ['diskutil', 'list', '-plist'],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            import plistlib
            plist = plistlib.loads(result.stdout.encode())
            for disk_name in plist.get('AllDisksAndPartitions', []):
                # Check if this disk is internal
                dev = disk_name.get('DeviceIdentifier', '')
                try:
                    info_result = subprocess.run(
                        ['diskutil', 'info', '-plist', dev],
                        capture_output=True, text=True, timeout=10
                    )
                    if info_result.returncode == 0:
                        info = plistlib.loads(info_result.stdout.encode())
                        if info.get('Internal', False):
                            # Add all volume names from this internal disk
                            vol_name = info.get('VolumeName', '')
                            if vol_name:
                                internal.add(vol_name)
                            # Check APFS sub-volumes
                            for part in disk_name.get('APFSVolumes', []) + disk_name.get('Partitions', []):
                                vn = part.get('VolumeName', '') or part.get('MountPoint', '').split('/')[-1]
                                if vn:
                                    internal.add(vn)
                except Exception:
                    pass
    except Exception as e:
        logging.error(f"diskutil error: {e}")

    # Always skip these known internal names as fallback
    internal.update({'Macintosh HD', 'Macintosh HD - Data', 'Preboot', 'Recovery', 'VM'})
    return internal


def get_external_drives():
    """Detect external drives on macOS via /Volumes, filtering out internal disks."""
    drives = []
    volumes_path = '/Volumes'
    internal_names = _get_internal_volume_names()

    try:
        entries = os.listdir(volumes_path)
    except OSError:
        return drives

    for name in entries:
        vol_path = os.path.join(volumes_path, name)
        if not os.path.ismount(vol_path):
            continue

        # Skip internal volumes
        if vol_path == '/' or name in internal_names:
            continue

        try:
            stat = os.statvfs(vol_path)
            total = stat.f_frsize * stat.f_blocks
            free = stat.f_frsize * stat.f_bavail
            used = total - free

            # Skip tiny volumes (< 1GB) - likely system partitions
            if total < 1_000_000_000:
                continue

            # Skip Final Cut Pro / macOS temporary disk images
            _skip_prefixes = ('msu-target-', 'fcpx-', 'com.apple.', '.disk_label')
            if any(name.lower().startswith(p) for p in _skip_prefixes):
                logging.info(f"Skipping temp volume: {name}")
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
            # Small pause between directories to avoid hogging I/O
            time.sleep(0.01)
    except (OSError, PermissionError):
        pass
    return total_size, file_count


def get_folder_mtime(path):
    """Get the latest modification time across a folder tree."""
    latest = 0
    try:
        latest = os.path.getmtime(path)
        for dirpath, dirnames, filenames in os.walk(path):
            try:
                t = os.path.getmtime(dirpath)
                if t > latest:
                    latest = t
            except (OSError, PermissionError):
                pass
            # Only check directory mtimes, not every file — much faster
            # Directory mtime changes when files are added/removed inside it
    except (OSError, PermissionError):
        pass
    return latest


# Cache: { folder_path: { 'mtime': float, 'size': int, 'file_count': int } }
# Persisted to disk so restarts don't trigger full re-scans
CACHE_FILE = os.path.join(CONFIG_DIR, 'scan_cache.json')
_scan_cache = {}
_cache_dirty = False


def _load_cache():
    """Load scan cache from disk on startup."""
    global _scan_cache
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, 'r') as f:
                _scan_cache = json.load(f)
            logging.info(f"Loaded scan cache with {len(_scan_cache)} entries from disk")
    except Exception as e:
        logging.warning(f"Could not load scan cache: {e} — starting fresh")
        _scan_cache = {}


def _save_cache():
    """Persist scan cache to disk."""
    global _cache_dirty
    if not _cache_dirty:
        return
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump(_scan_cache, f)
        _cache_dirty = False
    except Exception as e:
        logging.warning(f"Could not save scan cache: {e}")


_load_cache()


def get_folder_size_cached(path):
    """Get folder size, using cache if folder hasn't changed."""
    global _cache_dirty
    mtime = get_folder_mtime(path)
    cached = _scan_cache.get(path)
    if cached and cached['mtime'] >= mtime:
        return cached['size'], cached['file_count']

    # Folder changed or not cached — do full walk
    size, file_count = get_folder_size(path)
    _scan_cache[path] = {'mtime': mtime, 'size': size, 'file_count': file_count}
    _cache_dirty = True
    return size, file_count


def scan_drive_folders(drive_path, force_full=False):
    """
    Scan drive with Client > Couple folder structure.
    Root level = clients, second level = couples.
    Uses cached sizes for unchanged folders (incremental scan).
    Set force_full=True to ignore cache (e.g. after delete).
    """
    if force_full:
        # Clear cache for this drive
        keys_to_remove = [k for k in _scan_cache if k.startswith(drive_path)]
        for k in keys_to_remove:
            del _scan_cache[k]

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
                size, file_count = get_folder_size_cached(couple_path)
                couples.append({
                    'name': couple_name,
                    'size': size,
                    'file_count': file_count,
                })

        if not has_subdirs:
            size, file_count = get_folder_size_cached(client_path)
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

API_KEY = os.environ.get('SCANNER_API_KEY', '')
if not API_KEY:
    # Try loading from config file
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scanner_config.json')
    if os.path.exists(config_path):
        try:
            with open(config_path) as f:
                cfg = json.load(f)
                API_KEY = cfg.get('api_key', '')
        except:
            pass
    if not API_KEY:
        API_KEY = 'bilal-scanner-key-2024'  # Legacy fallback — rotate this!
        logging.warning("Using legacy hardcoded API key — set SCANNER_API_KEY env var or create scanner_config.json")


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


def api_get(config, endpoint):
    """GET request to dashboard API."""
    url = f"{config['api_url']}/api/{endpoint}"
    req = urllib.request.Request(url, method='GET')
    req.add_header('x-api-key', API_KEY)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        logging.error(f"API GET failed for {endpoint}: {e}")
        return None


def api_patch(config, endpoint, data):
    """PATCH request to dashboard API."""
    url = f"{config['api_url']}/api/{endpoint}"
    body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='PATCH')
    req.add_header('Content-Type', 'application/json')
    req.add_header('x-api-key', API_KEY)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        logging.error(f"API PATCH failed for {endpoint}: {e}")
        return None


def get_machine_name():
    """Get this Mac's computer name."""
    try:
        result = subprocess.run(['scutil', '--get', 'ComputerName'], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass
    import socket
    return socket.gethostname()


def sync_drive(config, drive_info, clients):
    data = {
        'drive': {
            'volume_label': drive_info['label'],
            'total_size_bytes': drive_info['total'],
            'used_bytes': drive_info['used'],
            'free_bytes': drive_info['free'],
            'drive_letter': drive_info.get('path', ''),
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


def send_heartbeat(config, connected_drive_labels):
    """Send heartbeat to dashboard so device shows as online."""
    data = {
        'machine_name': get_machine_name(),
        'platform': 'mac',
        'connected_drives': connected_drive_labels,
    }
    api_request(config, 'heartbeat', data)


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


# ─── Download Command Processor ────────────────────────────────────────────

import shutil

def poll_download_commands(config, known_drives):
    """Check for pending download commands from the dashboard."""
    machine = get_machine_name()
    encoded_machine = urllib.parse.quote(machine, safe='')
    commands = api_get(config, f'download-commands?machine={encoded_machine}')
    if not commands or not isinstance(commands, list):
        return

    for cmd in commands:
        cmd_id = cmd.get('id')
        command = cmd.get('command')
        project_id = cmd.get('project_id')
        payload = cmd.get('payload', {})

        logging.info(f"Received command: {command} for project {project_id}")

        # Acknowledge the command
        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'acked'
        })

        try:
            if command == 'copy_to_drive':
                handle_copy_to_drive(config, project_id, payload, known_drives, cmd_id)
            elif command == 'delete_data':
                handle_delete_data(config, payload, known_drives, cmd_id)
            elif command == 'cancel_download':
                # Just mark complete — actual cancellation handled by status check
                api_patch(config, 'download-commands', {
                    'id': cmd_id, 'status': 'completed'
                })
            else:
                logging.info(f"Unhandled command: {command}")
                api_patch(config, 'download-commands', {
                    'id': cmd_id, 'status': 'completed'
                })
        except Exception as e:
            logging.error(f"Command {command} failed: {e}")
            api_patch(config, 'download-commands', {
                'id': cmd_id, 'status': 'failed', 'error_message': str(e)[:500]
            })


def handle_copy_to_drive(config, project_id, payload, known_drives, cmd_id):
    """Copy downloaded data from cloud sync folder to target external drive."""
    source_path = payload.get('source_path', '')
    target_drive_label = payload.get('target_drive', '')
    client_name = payload.get('client_name', 'Unknown')
    couple_name = payload.get('couple_name', 'Unknown')

    if not source_path or not os.path.exists(source_path):
        raise Exception(f"Source path not found: {source_path}")

    # Find target drive path from known drives
    target_path = None
    for label, drive in known_drives.items():
        if label == target_drive_label:
            target_path = drive['path']
            break

    if not target_path:
        raise Exception(f"Target drive not found: {target_drive_label}")

    # Path traversal check
    dest = os.path.join(target_path, client_name, couple_name)
    real_dest = os.path.realpath(dest)
    if not real_dest.startswith(os.path.realpath(target_path)):
        raise Exception("Path traversal detected — refusing to copy outside drive")

    os.makedirs(dest, exist_ok=True)

    # Report copying status
    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': 'copying',
        'progress_bytes': 0,
    })

    # Copy files
    total_copied = 0
    if os.path.isdir(source_path):
        for item in os.listdir(source_path):
            src = os.path.join(source_path, item)
            dst = os.path.join(dest, item)
            if os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(src, dst)
            total_copied += os.path.getsize(src) if os.path.isfile(src) else 0
            # Report progress
            api_request(config, 'download-progress', {
                'project_id': project_id,
                'status': 'copying',
                'progress_bytes': total_copied,
            })
            time.sleep(0.01)  # I/O throttle
    else:
        shutil.copy2(source_path, dest)

    # Report completion
    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': 'completed',
        'progress_bytes': total_copied,
    })

    api_patch(config, 'download-commands', {
        'id': cmd_id, 'status': 'completed'
    })

    logging.info(f"Copied {client_name}/{couple_name} to {target_drive_label} ({format_size(total_copied)})")


def handle_delete_data(config, payload, known_drives, cmd_id):
    """Delete a client/couple folder from a drive, sending it to Trash."""
    drive_label = payload.get('drive_label', '')
    client_name = payload.get('client_name', '')
    couple_name = payload.get('couple_name', '')

    if not drive_label or not client_name:
        raise Exception("Missing drive_label or client_name in payload")

    # Find the drive path
    target_path = None
    for label in known_drives:
        if label == drive_label:
            # On Mac, drives are at /Volumes/<label>
            target_path = f"/Volumes/{label}"
            break

    if not target_path or not os.path.exists(target_path):
        raise Exception(f"Drive not found or not connected: {drive_label}")

    # Build path to the folder to delete
    if couple_name:
        folder_path = os.path.join(target_path, client_name, couple_name)
    else:
        folder_path = os.path.join(target_path, client_name)

    # Path traversal check
    real_path = os.path.realpath(folder_path)
    if not real_path.startswith(os.path.realpath(target_path)):
        raise Exception("Path traversal detected — refusing to delete outside drive")

    if not os.path.exists(folder_path):
        raise Exception(f"Folder not found: {folder_path}")

    # Try multiple methods to delete
    deleted = False

    # Method 1: Finder via AppleScript (respects macOS permissions, moves to Trash)
    try:
        escaped_path = folder_path.replace('"', '\\"')
        result = subprocess.run(
            ['osascript', '-e', f'tell application "Finder" to delete POSIX file "{escaped_path}"'],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            logging.info(f"Moved to Trash via Finder: {folder_path}")
            deleted = True
        else:
            logging.warning(f"Finder trash failed: {result.stderr.strip()}, trying fallback...")
    except Exception as e:
        logging.warning(f"Finder method failed: {e}, trying fallback...")

    # Method 2: macOS 'mv' to Trash manually
    if not deleted:
        try:
            trash_path = os.path.expanduser('~/.Trash')
            folder_name = os.path.basename(folder_path)
            dest = os.path.join(trash_path, folder_name)
            # Handle name collision in Trash
            if os.path.exists(dest):
                dest = os.path.join(trash_path, f"{folder_name}_{int(time.time())}")
            shutil.move(folder_path, dest)
            logging.info(f"Moved to Trash manually: {folder_path} -> {dest}")
            deleted = True
        except Exception as e:
            logging.warning(f"Manual trash failed: {e}, trying direct delete...")

    # Method 3: Direct delete (last resort, not recoverable)
    if not deleted:
        try:
            shutil.rmtree(folder_path)
            logging.info(f"Directly deleted (not recoverable): {folder_path}")
            deleted = True
        except Exception as e:
            raise Exception(f"All delete methods failed. Last error: {e}")

    # Clean up empty client folder if we deleted a couple
    if couple_name:
        client_dir = os.path.join(target_path, client_name)
        if os.path.exists(client_dir) and not os.listdir(client_dir):
            os.rmdir(client_dir)
            logging.info(f"Removed empty client folder: {client_dir}")

    api_patch(config, 'download-commands', {
        'id': cmd_id, 'status': 'completed'
    })
    logging.info(f"Delete command completed: {drive_label}/{client_name}/{couple_name}")

    # Immediately rescan and sync the drive so portal updates right away
    try:
        drive_info = known_drives.get(drive_label)
        if drive_info:
            drive_path = drive_info.get('path', target_path)
            logging.info(f"Triggering immediate rescan of {drive_label} after delete...")
            clients_after = scan_drive_folders(drive_path, force_full=True)
            rescan_drive = {
                'label': drive_label,
                'total': drive_info.get('total', 0),
                'used': drive_info.get('used', 0),
                'free': drive_info.get('free', 0),
                'path': drive_path,
            }
            sync_drive(config, rescan_drive, clients_after)
            _save_cache()
            logging.info(f"Post-delete rescan and sync complete for {drive_label}")
    except Exception as rescan_err:
        logging.error(f"Post-delete rescan failed (will sync on next cycle): {rescan_err}")


def watch_cloud_sync_folder(config, known_drives):
    """Monitor cloud sync folders for completed downloads and auto-copy."""
    # Get projects that are in 'downloading' state assigned to this machine
    machine = get_machine_name()
    # This will be called periodically from _check to monitor sync progress
    pass


# ─── Drive Monitor ──────────────────────────────────────────────────────────

class DriveMonitor:
    def __init__(self, config, on_status=None):
        self.config = config
        self.running = False
        self.known_drives = {}
        self.last_scan = {}
        self.last_update_check = 0
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

        # Send heartbeat
        connected_labels = [d['label'] for d in current]
        send_heartbeat(self.config, connected_labels)

        # Poll for download commands from dashboard
        try:
            poll_download_commands(self.config, self.known_drives)
        except Exception as e:
            logging.error(f"Download command poll error: {e}")

        # Check for updates every 5 minutes
        if time.time() - self.last_update_check > 300:
            self.last_update_check = time.time()
            threading.Thread(target=auto_update, daemon=True).start()

    def _scan_and_sync(self, drive):
        # Set low priority so scanning doesn't affect workflow
        try:
            os.nice(10)  # Lower CPU priority
        except OSError:
            pass
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

        # Persist cache to disk so restarts don't trigger full re-scans
        _save_cache()

        self.last_scan[drive['label']] = time.time()

        # Low space warning
        threshold = self.config.get('low_space_gb', 100) * 1024**3
        if drive['free'] < threshold:
            self.status(f"WARNING: {drive['label']} has only {format_size(drive['free'])} free!")
            try:
                label = drive['label'].replace('"', '')
                free_str = format_size(drive['free'])
                subprocess.run([
                    'osascript', '-e',
                    f'display notification "{label} has only {free_str} free!" with title "Bilal - Drive Man" subtitle "Low Space Warning"'
                ], timeout=5)
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
            super().__init__(f"Mac Scanner V.{VERSION}", icon=None, title="BD")
            self.monitor = DriveMonitor(config, on_status=self._on_status)
            self.status_item = rumps.MenuItem("Status: Starting...")
            self.status_item.set_callback(None)
            self.version_item = rumps.MenuItem(f"V.{VERSION}")
            self.version_item.set_callback(None)
            self.menu = [
                self.status_item,
                None,
                rumps.MenuItem("Scan Now", callback=self._scan_now),
                rumps.MenuItem("Open Dashboard", callback=self._open_dashboard),
                None,
                rumps.MenuItem("View Log", callback=self._view_log),
                None,
                self.version_item,
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
                f"Mac Scanner V.{VERSION}",
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
    print(f"  Mac Scanner V.{VERSION} - BILAL DRIVE MAN")
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
