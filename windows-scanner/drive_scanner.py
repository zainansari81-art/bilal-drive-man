"""
Windows Scanner V.3.29.3 - BILAL DRIVE MAN
Runs in system tray, auto-detects external drives,
scans folders (Client > Couple structure), and syncs to the online dashboard.
"""

VERSION = '3.32.0'

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
import urllib.parse
import urllib.parse
from datetime import datetime

# ─── Auto-Update ─────────────────────────────────────────────────────────────

GITHUB_RAW_URL = 'https://raw.githubusercontent.com/zainansari81-art/bilal-drive-man/main/windows-scanner/drive_scanner.py'

def auto_update():
    """Check GitHub for newer version and replace self if updated."""
    try:
        script_path = os.path.abspath(__file__)
        with open(script_path, 'r') as f:
            current = f.read()

        req = urllib.request.Request(GITHUB_RAW_URL)
        req.add_header('Cache-Control', 'no-cache')
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
    'dropbox_path': '',    # e.g. D:\Dropbox or C:\Users\<user>\Dropbox
    'gdrive_path': '',     # e.g. G:\My Drive or G:\
    'is_download_pc': False,
    'dropbox_token': '',
    'dropbox_refresh_token': '',
    'dropbox_app_key': '',
    'dropbox_app_secret': '',
    'gdrive_token': '',
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
            # 2=Removable, 3=Fixed, 4=Network/Cloud (Dropbox, OneDrive, etc.)
            if dt in (2, 3, 4) and letter != 'C':
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


# ─── Cloud File Status ──────────────────────────────────────────────────────

# Windows file attributes for cloud files (Dropbox, Google Drive, OneDrive)
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x00400000  # File is cloud-only placeholder
FILE_ATTRIBUTE_PINNED = 0x00080000                  # File is pinned for offline
FILE_ATTRIBUTE_UNPINNED = 0x00100000                # File is explicitly online-only


def is_file_offline(filepath):
    """Check if a cloud-synced file is fully available offline (not a placeholder)."""
    try:
        attrs = ctypes.windll.kernel32.GetFileAttributesW(filepath)
        if attrs == -1:  # INVALID_FILE_ATTRIBUTES
            return False
        # If RECALL_ON_DATA_ACCESS is set, file is a cloud placeholder (not downloaded)
        return not (attrs & FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
    except Exception:
        return False


def pin_file_offline(filepath):
    """Pin a cloud file for offline access (forces download from cloud)."""
    try:
        # Get current attributes
        attrs = ctypes.windll.kernel32.GetFileAttributesW(filepath)
        if attrs == -1:
            return False
        # Set PINNED attribute (forces offline), remove UNPINNED if set
        new_attrs = (attrs | FILE_ATTRIBUTE_PINNED) & ~FILE_ATTRIBUTE_UNPINNED
        result = ctypes.windll.kernel32.SetFileAttributesW(filepath, new_attrs)
        return bool(result)
    except Exception as e:
        logging.error(f"Failed to pin file {filepath}: {e}")
        return False


def pin_folder_offline(folder_path):
    """
    Pin all files in a cloud folder for offline access.
    This forces Dropbox/Google Drive desktop app to download files locally.
    """
    if not os.path.exists(folder_path):
        return 0, 0

    total = 0
    pinned = 0
    try:
        for dirpath, dirnames, filenames in os.walk(folder_path):
            # Pin the directory itself
            pin_file_offline(dirpath)
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                total += 1
                if pin_file_offline(filepath):
                    pinned += 1
                time.sleep(0.01)  # Don't hammer the filesystem
    except (OSError, PermissionError) as e:
        logging.error(f"Error pinning folder: {e}")

    logging.info(f"Pinned {pinned}/{total} files in {folder_path}")
    return total, pinned


def check_folder_offline_status(folder_path):
    """
    Check if all files in a cloud sync folder are fully offline.
    Returns (is_ready, total_files, offline_files, total_size_bytes).
    """
    if not os.path.exists(folder_path):
        return False, 0, 0, 0

    total_files = 0
    offline_files = 0
    total_size = 0

    try:
        for dirpath, _, filenames in os.walk(folder_path):
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                total_files += 1
                if is_file_offline(filepath):
                    offline_files += 1
                    try:
                        total_size += os.path.getsize(filepath)
                    except OSError:
                        pass
            time.sleep(0.01)  # Avoid blocking I/O
    except (OSError, PermissionError) as e:
        logging.error(f"Error checking folder offline status: {e}")

    is_ready = total_files > 0 and offline_files == total_files
    return is_ready, total_files, offline_files, total_size


def find_cloud_folder(config, link_type, couple_name):
    """
    Find the cloud sync folder for a project based on its link type.
    Searches common Dropbox/Google Drive sync folder structures.
    """
    if link_type == 'dropbox':
        base = config.get('dropbox_path', '')
    elif link_type == 'google_drive':
        base = config.get('gdrive_path', '')
    else:
        return None

    if not base or not os.path.exists(base):
        return None

    # Search for folder matching the couple/project name
    couple_lower = couple_name.lower().strip()

    # Direct match in root
    for entry in os.listdir(base):
        entry_path = os.path.join(base, entry)
        if os.path.isdir(entry_path) and entry.lower().strip() == couple_lower:
            return entry_path

    # Partial match (folder name contains the couple name)
    for entry in os.listdir(base):
        entry_path = os.path.join(base, entry)
        if os.path.isdir(entry_path) and couple_lower in entry.lower():
            return entry_path

    # Search one level deeper
    for entry in os.listdir(base):
        entry_path = os.path.join(base, entry)
        if os.path.isdir(entry_path):
            try:
                for sub in os.listdir(entry_path):
                    sub_path = os.path.join(entry_path, sub)
                    if os.path.isdir(sub_path) and couple_lower in sub.lower():
                        return sub_path
            except (OSError, PermissionError):
                pass

    return None


# ─── Cloud API Integration ──────────────────────────────────────────────────

def refresh_dropbox_token(config):
    """Refresh Dropbox access token using refresh token."""
    refresh_token = config.get('dropbox_refresh_token', '')
    app_key = config.get('dropbox_app_key', '')
    app_secret = config.get('dropbox_app_secret', '')

    if not refresh_token or not app_key or not app_secret:
        return None

    body = urllib.parse.urlencode({
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
        'client_id': app_key,
        'client_secret': app_secret,
    }).encode('utf-8')

    req = urllib.request.Request('https://api.dropboxapi.com/oauth2/token', data=body, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            new_token = data.get('access_token', '')
            if new_token:
                config['dropbox_token'] = new_token
                save_config(config)
                logging.info("Refreshed Dropbox access token")
                return new_token
    except Exception as e:
        logging.error(f"Failed to refresh Dropbox token: {e}")
    return None


def get_dropbox_token(config):
    """Get a valid Dropbox access token, refreshing if needed."""
    token = config.get('dropbox_token', '')
    if token:
        # Try using the token — if it fails, refresh
        return token
    return refresh_dropbox_token(config)


def add_dropbox_shared_folder(access_token, shared_link):
    """Add a Dropbox shared folder/link to the user's account."""
    import re

    # Extract shared folder ID from Dropbox link
    # First get metadata about the shared link
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json',
    }

    # Get shared link metadata
    body = json.dumps({'url': shared_link}).encode('utf-8')
    req = urllib.request.Request(
        'https://api.dropboxapi.com/2/sharing/get_shared_link_metadata',
        data=body, method='POST'
    )
    for k, v in headers.items():
        req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            meta = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode() if e.fp else ''
        logging.error(f"Dropbox metadata error: {e.code} {err}")
        raise Exception(f"Failed to get Dropbox link info: {err}")

    # If it's a shared folder, mount it
    if meta.get('.tag') == 'folder':
        shared_folder_id = meta.get('shared_folder_id') or meta.get('id', '').replace('id:', '')

        if shared_folder_id:
            mount_body = json.dumps({'shared_folder_id': shared_folder_id}).encode('utf-8')
            mount_req = urllib.request.Request(
                'https://api.dropboxapi.com/2/sharing/mount_folder',
                data=mount_body, method='POST'
            )
            for k, v in headers.items():
                mount_req.add_header(k, v)

            try:
                with urllib.request.urlopen(mount_req, timeout=30) as resp:
                    result = json.loads(resp.read().decode())
                    folder_name = result.get('name', meta.get('name', 'Unknown'))
                    logging.info(f"Mounted Dropbox folder: {folder_name}")
                    return folder_name
            except urllib.error.HTTPError as e:
                err = e.read().decode() if e.fp else ''
                # already_mounted is OK
                if 'already_mounted' in err:
                    logging.info(f"Dropbox folder already mounted: {meta.get('name', '')}")
                    return meta.get('name', 'Unknown')
                logging.error(f"Dropbox mount error: {err}")
                raise Exception(f"Failed to mount Dropbox folder: {err}")

    # If it's a file, save it to the account
    save_body = json.dumps({
        'url': shared_link,
        'path': f"/{meta.get('name', 'download')}",
    }).encode('utf-8')
    save_req = urllib.request.Request(
        'https://api.dropboxapi.com/2/sharing/save_url/save_url',
        data=save_body, method='POST'
    )
    for k, v in headers.items():
        save_req.add_header(k, v)

    # For files, just return the name — user may need to handle manually
    return meta.get('name', 'Unknown')


def add_gdrive_shared_folder(access_token, shared_link):
    """Add a Google Drive shared folder/file to the user's My Drive."""
    import re

    # Extract file/folder ID from Google Drive link
    match = re.search(r'/folders/([a-zA-Z0-9_-]+)', shared_link)
    if not match:
        match = re.search(r'/d/([a-zA-Z0-9_-]+)', shared_link)
    if not match:
        match = re.search(r'id=([a-zA-Z0-9_-]+)', shared_link)
    if not match:
        raise Exception(f"Could not extract file ID from Google Drive link")

    file_id = match.group(1)

    # Get file metadata first
    headers = {
        'Authorization': f'Bearer {access_token}',
    }

    meta_req = urllib.request.Request(
        f'https://www.googleapis.com/drive/v3/files/{file_id}?fields=id,name,mimeType&supportsAllDrives=true',
        method='GET'
    )
    for k, v in headers.items():
        meta_req.add_header(k, v)

    try:
        with urllib.request.urlopen(meta_req, timeout=30) as resp:
            meta = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode() if e.fp else ''
        logging.error(f"Google Drive metadata error: {e.code} {err}")
        raise Exception(f"Failed to get Google Drive file info: {err}")

    folder_name = meta.get('name', 'Unknown')

    # Create a shortcut in My Drive pointing to the shared folder
    shortcut_body = json.dumps({
        'name': folder_name,
        'mimeType': 'application/vnd.google-apps.shortcut',
        'shortcutDetails': {
            'targetId': file_id,
        },
        'parents': ['root'],
    }).encode('utf-8')

    shortcut_req = urllib.request.Request(
        'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
        data=shortcut_body, method='POST'
    )
    shortcut_req.add_header('Authorization', f'Bearer {access_token}')
    shortcut_req.add_header('Content-Type', 'application/json')

    try:
        with urllib.request.urlopen(shortcut_req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
            logging.info(f"Added Google Drive shortcut: {folder_name}")
            return folder_name
    except urllib.error.HTTPError as e:
        err = e.read().decode() if e.fp else ''
        # If shortcut already exists, that's fine
        if 'already exists' in err.lower():
            return folder_name
        logging.error(f"Google Drive shortcut error: {err}")
        raise Exception(f"Failed to add to Google Drive: {err}")


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


def send_heartbeat(config, connected_drive_labels):
    """Send heartbeat to dashboard so device shows as online."""
    data = {
        'machine_name': get_machine_name(),
        'platform': 'windows',
        'connected_drives': connected_drive_labels,
        'is_download_pc': config.get('is_download_pc', False),
        'dropbox_path': config.get('dropbox_path', ''),
        'gdrive_path': config.get('gdrive_path', ''),
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
    commands = api_get(config, f'download-commands?machine={machine}')
    if not commands or not isinstance(commands, list):
        return

    for cmd in commands:
        cmd_id = cmd.get('id')
        command = cmd.get('command')
        project_id = cmd.get('project_id')
        payload = cmd.get('payload', {})

        logging.info(f"Received command: {command} for project {project_id}")

        # Acknowledge
        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'acked'
        })

        try:
            if command == 'copy_to_drive':
                # Run in background thread to avoid blocking main loop
                threading.Thread(
                    target=_safe_run_command,
                    args=(handle_copy_to_drive, config, project_id, payload, known_drives, cmd_id),
                    daemon=True
                ).start()
            elif command == 'start_download':
                # Run in background thread — this monitors cloud folder for hours
                threading.Thread(
                    target=_safe_run_command,
                    args=(handle_start_download, config, project_id, payload, known_drives, cmd_id),
                    daemon=True
                ).start()
            elif command == 'add_to_cloud':
                handle_add_to_cloud(config, project_id, payload, cmd_id)
            elif command == 'check_cloud_status':
                handle_check_cloud_status(config, project_id, payload, cmd_id)
            elif command == 'cancel_download':
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


def _safe_run_command(handler, config, project_id, payload, known_drives, cmd_id):
    """Wrapper to run command handlers in background threads with error handling."""
    try:
        handler(config, project_id, payload, known_drives, cmd_id)
    except Exception as e:
        logging.error(f"Background command failed: {e}")
        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'failed', 'error_message': str(e)[:500]
        })


def handle_add_to_cloud(config, project_id, payload, cmd_id):
    """Add a shared Dropbox/Google Drive link to the user's cloud account."""
    download_link = payload.get('download_link', '')
    link_type = payload.get('link_type', '')
    couple_name = payload.get('couple_name', '')

    if not download_link:
        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'failed',
            'error_message': 'No download link provided',
        })
        return

    # Get cloud tokens from config (auto-refresh if needed)
    dropbox_token = get_dropbox_token(config) if link_type == 'dropbox' else None
    gdrive_token = config.get('gdrive_token', '') if link_type == 'google_drive' else None

    try:
        folder_name = None
        if link_type == 'dropbox' and dropbox_token:
            try:
                folder_name = add_dropbox_shared_folder(dropbox_token, download_link)
            except Exception as e:
                # Token might be expired — try refreshing
                if '401' in str(e) or 'expired' in str(e).lower():
                    new_token = refresh_dropbox_token(config)
                    if new_token:
                        folder_name = add_dropbox_shared_folder(new_token, download_link)
                    else:
                        raise
                else:
                    raise
        elif link_type == 'google_drive' and gdrive_token:
            folder_name = add_gdrive_shared_folder(gdrive_token, download_link)
        else:
            token_missing = 'dropbox_token' if link_type == 'dropbox' else 'gdrive_token'
            api_patch(config, 'download-commands', {
                'id': cmd_id, 'status': 'failed',
                'error_message': f'No {token_missing} configured in scanner settings',
            })
            return

        # Report success — update project cloud status
        api_request(config, 'download-progress', {
            'project_id': project_id,
            'status': 'downloading',
        })

        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'completed',
        })

        logging.info(f"Added to cloud: {folder_name or couple_name} ({link_type})")

    except Exception as e:
        logging.error(f"Add to cloud failed: {e}")
        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'failed',
            'error_message': str(e)[:500],
        })


def handle_copy_to_drive(config, project_id, payload, known_drives, cmd_id):
    """Copy downloaded data from cloud sync folder to target external drive."""
    source_path = payload.get('source_path', '')
    target_drive_label = payload.get('target_drive', '')
    client_name = payload.get('client_name', 'Unknown')
    couple_name = payload.get('couple_name', 'Unknown')

    if not source_path or not os.path.exists(source_path):
        raise Exception(f"Source path not found: {source_path}")

    # Find target drive
    target_path = None
    for label, drive in known_drives.items():
        if label == target_drive_label:
            target_path = f"{drive['letter']}:\\"
            break

    if not target_path:
        raise Exception(f"Target drive not found: {target_drive_label}")

    dest = os.path.join(target_path, client_name, couple_name)
    os.makedirs(dest, exist_ok=True)

    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': 'copying',
        'progress_bytes': 0,
    })

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
            api_request(config, 'download-progress', {
                'project_id': project_id,
                'status': 'copying',
                'progress_bytes': total_copied,
            })
            time.sleep(0.01)
    else:
        shutil.copy2(source_path, dest)

    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': 'completed',
        'progress_bytes': total_copied,
    })

    api_patch(config, 'download-commands', {
        'id': cmd_id, 'status': 'completed'
    })

    logging.info(f"Copied {client_name}/{couple_name} to {target_drive_label} ({format_size(total_copied)})")


def handle_start_download(config, project_id, payload, known_drives, cmd_id):
    """
    Monitor a cloud sync folder until files are fully offline, then copy to target drive.
    This is the main download workflow:
    1. Find the cloud folder for this project
    2. Monitor until all files are offline (user marks them for offline in desktop app)
    3. Once ready, auto-copy to the target external drive
    """
    cloud_folder = payload.get('cloud_folder_path', '')
    link_type = payload.get('link_type', '')
    couple_name = payload.get('couple_name', '')
    client_name = payload.get('client_name', 'Unknown')
    target_drive_label = payload.get('target_drive', '')

    # Try to find the cloud folder if not explicitly provided
    if not cloud_folder or not os.path.exists(cloud_folder):
        cloud_folder = find_cloud_folder(config, link_type, couple_name)

    if not cloud_folder:
        # Report that we couldn't find the folder
        api_request(config, 'download-progress', {
            'project_id': project_id,
            'status': 'failed',
            'error_message': f'Cloud folder not found for "{couple_name}". Configure cloud paths in scanner settings.',
        })
        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'failed',
            'error_message': 'Cloud folder not found',
        })
        return

    logging.info(f"Monitoring cloud folder: {cloud_folder}")

    # Report the found folder path back
    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': 'downloading',
    })

    # Auto-pin all files for offline (forces cloud app to download them)
    logging.info(f"Pinning files for offline in: {cloud_folder}")
    total_pinned, pinned_count = pin_folder_offline(cloud_folder)
    logging.info(f"Pinned {pinned_count}/{total_pinned} files for offline download")

    # Monitor until offline or timeout (check every 30 seconds for up to 24 hours)
    max_checks = 2880  # 24 hours at 30-second intervals
    for check_num in range(max_checks):
        is_ready, total_files, offline_files, total_size = check_folder_offline_status(cloud_folder)

        # Report progress
        if total_files > 0:
            api_request(config, 'download-progress', {
                'project_id': project_id,
                'status': 'downloading',
                'progress_bytes': total_size,
            })

        logging.info(f"Cloud check #{check_num + 1}: {offline_files}/{total_files} files offline in {cloud_folder}")

        if is_ready:
            logging.info(f"All {total_files} files are offline! Starting copy...")
            break

        time.sleep(30)

    else:
        # Timed out
        api_request(config, 'download-progress', {
            'project_id': project_id,
            'status': 'failed',
            'error_message': 'Timed out waiting for files to go offline',
        })
        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'failed',
            'error_message': 'Timeout waiting for offline',
        })
        return

    # Files are ready — copy to target drive
    if target_drive_label:
        copy_payload = {
            'source_path': cloud_folder,
            'target_drive': target_drive_label,
            'client_name': client_name,
            'couple_name': couple_name,
        }
        handle_copy_to_drive(config, project_id, copy_payload, known_drives, cmd_id)
    else:
        # No target drive specified — just mark as ready
        api_request(config, 'download-progress', {
            'project_id': project_id,
            'status': 'completed',
            'progress_bytes': total_size,
        })
        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'completed'
        })
        logging.info(f"Files offline for {couple_name} but no target drive specified")


def handle_check_cloud_status(config, project_id, payload, cmd_id):
    """Quick check of cloud folder offline status without waiting."""
    cloud_folder = payload.get('cloud_folder_path', '')
    link_type = payload.get('link_type', '')
    couple_name = payload.get('couple_name', '')

    if not cloud_folder or not os.path.exists(cloud_folder):
        cloud_folder = find_cloud_folder(config, link_type, couple_name)

    if not cloud_folder:
        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'completed',
            'error_message': 'Cloud folder not found',
        })
        return

    is_ready, total_files, offline_files, total_size = check_folder_offline_status(cloud_folder)

    # Report status
    status = 'completed' if is_ready else 'downloading'
    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': status,
        'progress_bytes': total_size,
    })

    api_patch(config, 'download-commands', {
        'id': cmd_id, 'status': 'completed',
    })

    logging.info(f"Cloud status for {couple_name}: {offline_files}/{total_files} files offline ({format_size(total_size)})")


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

        # Send heartbeat
        connected_labels = [d['label'] for d in current]
        send_heartbeat(self.config, connected_labels)

        # Poll for download commands from dashboard
        try:
            poll_download_commands(self.config, self.known_drives)
        except Exception as e:
            logging.error(f"Download command poll error: {e}")

        # Check for updates every 60 seconds
        if time.time() - self.last_update_check > 60:
            self.last_update_check = time.time()
            threading.Thread(target=auto_update, daemon=True).start()

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
        pystray.MenuItem(f"Windows Scanner V.{VERSION}", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Scan Now", on_scan),
        pystray.MenuItem("Open Dashboard", on_open_dashboard),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit", on_quit),
    )

    icon = pystray.Icon("BilalDriveMan", img, f"Windows Scanner V.{VERSION}", menu)

    monitor.start()
    icon.run()


def run_console():
    """Run in console mode (no tray icon needed)."""
    config = load_config()
    print("=" * 50)
    print(f"  Windows Scanner V.{VERSION} - BILAL DRIVE MAN")
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
            print(f"Windows Scanner V.{VERSION} is already running!")
            sys.exit(0)
    except:
        pass

    if '--console' in sys.argv:
        run_console()
    else:
        run_with_tray()
