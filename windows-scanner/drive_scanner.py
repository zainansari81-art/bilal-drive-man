"""
Windows Scanner V.3.36.0 - BILAL DRIVE MAN
Runs in system tray, auto-detects external drives,
scans folders (Client > Couple structure), and syncs to the online dashboard.
"""

VERSION = '3.42.0'

import os
import sys
import time
import json
import string
import ctypes
import logging
import subprocess
import threading
import urllib.request
import urllib.error
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
    'gdrive_refresh_token': '',
    'gdrive_client_id': '',
    'gdrive_client_secret': '',
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
    """Get volume label using multiple methods as fallback."""
    # Method 1: Windows API (fastest, works for most NTFS/exFAT drives)
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
            label = volume_name.value.strip()
            if label:
                return label
    except Exception as e:
        logging.warning(f"Volume label API failed for {drive_letter}: {e}")

    # Method 2: WMIC command (works when API returns empty)
    try:
        result = subprocess.run(
            ['wmic', 'logicaldisk', 'where', f'DeviceID="{drive_letter}"', 'get', 'VolumeName'],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            lines = [l.strip() for l in result.stdout.strip().split('\n') if l.strip() and l.strip() != 'VolumeName']
            if lines and lines[0]:
                logging.info(f"Got label for {drive_letter} via WMIC: {lines[0]}")
                return lines[0]
    except Exception as e:
        logging.warning(f"WMIC label failed for {drive_letter}: {e}")

    # Method 3: VOL command (last resort)
    try:
        result = subprocess.run(
            ['cmd', '/c', 'vol', drive_letter],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and ' is ' in result.stdout:
            # Output: " Volume in drive D is Newyork 4tb"
            label = result.stdout.split(' is ')[-1].strip().split('\n')[0].strip()
            if label:
                logging.info(f"Got label for {drive_letter} via VOL: {label}")
                return label
    except Exception as e:
        logging.warning(f"VOL label failed for {drive_letter}: {e}")

    logging.error(f"All label methods failed for {drive_letter}")
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
                if not label:
                    logging.warning(f"Skipping {dl} (type={dt}) — no label from any method (unreadable filesystem?)")
                    continue
                try:
                    usage = get_drive_usage(dl)
                    drives.append({
                        'letter': dl,
                        'label': label,
                        **usage,
                    })
                    logging.info(f"Detected drive: {dl} label='{label}' type={dt} total={usage.get('total', 0)}")
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
    except (OSError, PermissionError):
        pass
    return latest


# Cache: { folder_path: { 'mtime': float, 'size': int, 'file_count': int } }
_scan_cache = {}


def get_folder_size_cached(path):
    """Get folder size, using cache if folder hasn't changed."""
    mtime = get_folder_mtime(path)
    cached = _scan_cache.get(path)
    if cached and cached['mtime'] >= mtime:
        return cached['size'], cached['file_count']

    # Folder changed or not cached — do full walk
    size, file_count = get_folder_size(path)
    _scan_cache[path] = {'mtime': mtime, 'size': size, 'file_count': file_count}
    return size, file_count


def scan_drive_folders(drive_letter, force_full=False):
    """
    Scan drive with Client > Couple folder structure.
    Root level = clients, second level = couples.
    Uses cached sizes for unchanged folders (incremental scan).
    """
    root = f"{drive_letter}\\"

    if force_full:
        keys_to_remove = [k for k in _scan_cache if k.startswith(root)]
        for k in keys_to_remove:
            del _scan_cache[k]

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


def refresh_gdrive_token(config):
    """Refresh Google Drive access token using stored refresh token."""
    refresh_token = config.get('gdrive_refresh_token', '')
    client_id = config.get('gdrive_client_id', '')
    client_secret = config.get('gdrive_client_secret', '')

    if not refresh_token or not client_id or not client_secret:
        logging.warning(
            "Cannot refresh GDrive token: missing gdrive_refresh_token / "
            "gdrive_client_id / gdrive_client_secret in scanner config"
        )
        return None

    body = urllib.parse.urlencode({
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
        'client_id': client_id,
        'client_secret': client_secret,
    }).encode('utf-8')

    req = urllib.request.Request('https://oauth2.googleapis.com/token', data=body, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            new_token = data.get('access_token', '')
            if new_token:
                config['gdrive_token'] = new_token
                save_config(config)
                logging.info("Refreshed Google Drive access token")
                return new_token
    except Exception as e:
        logging.error(f"Failed to refresh Google Drive token: {e}")
    return None


def call_with_token_retry(config, link_type, fn):
    """
    Run `fn(access_token)` with the current token; if it raises a 401/expired
    error, refresh the appropriate token and retry exactly once.
    """
    if link_type == 'dropbox':
        token = get_dropbox_token(config)
        refresher = refresh_dropbox_token
    elif link_type == 'google_drive':
        token = config.get('gdrive_token', '') or refresh_gdrive_token(config)
        refresher = refresh_gdrive_token
    else:
        return fn(None)

    if not token:
        raise Exception(f"No {link_type} token configured in scanner settings")

    try:
        return fn(token)
    except Exception as e:
        msg = str(e)
        if '401' in msg or 'expired' in msg.lower() or 'invalid_token' in msg.lower() or 'unauthorized' in msg.lower():
            new_token = refresher(config)
            if new_token:
                logging.info(f"Retrying {link_type} call after token refresh")
                return fn(new_token)
        raise


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

    # If it's a shared folder, mount it.
    # Graceful-degradation (v3.42.0): scl-era shared links can point to folders
    # the calling account already owns — those come back from
    # get_shared_link_metadata without a `shared_folder_id` field, because
    # nothing needs to be "mounted" (the folder is already in the user's
    # namespace). In that case we treat add_to_cloud as a no-op success and let
    # downstream start_download locate the folder via find_cloud_folder. We do
    # NOT fall back to meta['id'] — that's a file-item id, not a
    # shared_folder_id, and Dropbox correctly rejects it with invalid_id.
    if meta.get('.tag') == 'folder':
        shared_folder_id = meta.get('shared_folder_id')
        folder_name_hint = meta.get('name', 'Unknown')

        if not shared_folder_id:
            logging.info(
                f"Dropbox share '{folder_name_hint}' is already in the user's "
                f"namespace (no shared_folder_id in metadata); skipping mount."
            )
            return folder_name_hint

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
                folder_name = result.get('name', folder_name_hint)
                logging.info(f"Mounted Dropbox folder: {folder_name}")
                return folder_name
        except urllib.error.HTTPError as e:
            err = e.read().decode() if e.fp else ''
            # These error tags all mean "folder's already there / nothing to do";
            # treat as soft success so start_download can proceed.
            if (
                'already_mounted' in err
                or 'invalid_id' in err
                or 'access_error' in err
            ):
                logging.warning(
                    f"Dropbox mount_folder soft-failed for '{folder_name_hint}' "
                    f"({err.strip()[:200]}); treating as already in namespace."
                )
                return folder_name_hint
            # Anything else (auth, network, rate limits, etc) is real — surface it.
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
            elif command == 'delete_data':
                handle_delete_data(config, payload, known_drives, cmd_id)
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

    # Flip to the 'pinning' sub-phase so the UI can show it.
    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': 'downloading',
        'phase': 'pinning',
    })

    try:
        folder_name = None
        if link_type == 'dropbox':
            folder_name = call_with_token_retry(
                config, 'dropbox',
                lambda tok: add_dropbox_shared_folder(tok, download_link),
            )
        elif link_type == 'google_drive':
            folder_name = call_with_token_retry(
                config, 'google_drive',
                lambda tok: add_gdrive_shared_folder(tok, download_link),
            )
        else:
            api_patch(config, 'download-commands', {
                'id': cmd_id, 'status': 'failed',
                'error_message': f'Unsupported link_type: {link_type}',
            })
            return

        # Report success — also persist the resolved cloud folder's full local
        # path on the project row so start_download can locate the folder
        # directly without having to re-derive it via the fragile couple_name
        # substring match in find_cloud_folder. We write an absolute path
        # (e.g., C:\Users\txbla\Dropbox\ZAINN testing) rather than just the
        # folder name, because start_download checks os.path.exists() on the
        # value before falling back.
        progress_body = {
            'project_id': project_id,
            'status': 'downloading',
            'phase': 'pinning',
        }
        base = ''
        if link_type == 'dropbox':
            base = config.get('dropbox_path', '')
        elif link_type == 'google_drive':
            base = config.get('gdrive_path', '')
        if folder_name and base:
            progress_body['cloud_folder_path'] = os.path.join(base, folder_name)
        api_request(config, 'download-progress', progress_body)

        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'completed',
        })

        if progress_body.get('cloud_folder_path'):
            logging.info(
                f"Added to cloud and persisted cloud_folder_path: "
                f"'{progress_body['cloud_folder_path']}' ({link_type})"
            )
        else:
            logging.info(
                f"Added to cloud: {couple_name} ({link_type}) — "
                f"no cloud_folder_path persisted "
                f"(folder_name={folder_name!r}, base_configured={bool(base)})"
            )

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

    # Find target drive.
    # Note: drive['letter'] is stored WITH the trailing colon (e.g. "D:") in
    # get_external_drives, so constructing f"{drive['letter']}:\\" yields
    # "D::\\" which Windows rejects with WinError 123. Strip any trailing
    # colon before adding the path separator so we produce "D:\\" regardless
    # of how the letter was captured.
    target_path = None
    for label, drive in known_drives.items():
        if label == target_drive_label:
            letter = drive['letter'].rstrip(':')
            target_path = f"{letter}:\\"
            break

    if not target_path:
        raise Exception(f"Target drive not found: {target_drive_label}")

    dest = os.path.join(target_path, client_name, couple_name)

    # Path traversal check
    real_dest = os.path.realpath(dest)
    if not real_dest.startswith(os.path.realpath(target_path)):
        raise Exception("Path traversal detected — refusing to copy outside drive")

    os.makedirs(dest, exist_ok=True)

    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': 'copying',
        'progress_bytes': 0,
        'phase': 'copying',
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
                'phase': 'copying',
            })
            time.sleep(0.01)
    else:
        shutil.copy2(source_path, dest)

    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': 'completed',
        'progress_bytes': total_copied,
        'phase': '',
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

    # Report the found folder path back — phase is 'pinning' until we've
    # queued the files for offline, then flips to 'syncing'.
    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': 'downloading',
        'phase': 'pinning',
    })

    # Auto-pin all files for offline (forces cloud app to download them)
    logging.info(f"Pinning files for offline in: {cloud_folder}")
    total_pinned, pinned_count = pin_folder_offline(cloud_folder)
    logging.info(f"Pinned {pinned_count}/{total_pinned} files for offline download")

    # Flip phase to 'syncing' — cloud app is now pulling bytes.
    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': 'downloading',
        'phase': 'syncing',
    })

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
                'phase': 'syncing',
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


def handle_delete_data(config, payload, known_drives, cmd_id):
    """Delete a client/couple folder from a drive, sending it to Recycle Bin."""
    drive_label = payload.get('drive_label', '')
    client_name = payload.get('client_name', '')
    couple_name = payload.get('couple_name', '')

    if not drive_label or not client_name:
        raise Exception("Missing drive_label or client_name in payload")

    # Find the drive path (Windows drives use 'letter' key, e.g. 'D:')
    target_path = None
    for label, drive in known_drives.items():
        if label == drive_label:
            target_path = drive.get('path') or drive.get('letter') or f"{label}\\"
            break

    if not target_path:
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

    # Use send2trash to move to Recycle Bin (safe delete)
    try:
        from send2trash import send2trash
        send2trash(folder_path)
        logging.info(f"Moved to Recycle Bin: {folder_path}")
    except ImportError:
        # Fallback: use Windows shell COM to recycle
        try:
            import ctypes
            from ctypes import wintypes
            # SHFileOperationW with FOF_ALLOWUNDO sends to Recycle Bin
            class SHFILEOPSTRUCT(ctypes.Structure):
                _fields_ = [
                    ('hwnd', wintypes.HWND),
                    ('wFunc', ctypes.c_uint),
                    ('pFrom', ctypes.c_wchar_p),
                    ('pTo', ctypes.c_wchar_p),
                    ('fFlags', wintypes.WORD),
                    ('fAnyOperationsAborted', wintypes.BOOL),
                    ('hNameMappings', ctypes.c_void_p),
                    ('lpszProgressTitle', ctypes.c_wchar_p),
                ]
            FO_DELETE = 3
            FOF_ALLOWUNDO = 0x0040
            FOF_NOCONFIRMATION = 0x0010
            FOF_SILENT = 0x0004

            op = SHFILEOPSTRUCT()
            op.wFunc = FO_DELETE
            op.pFrom = folder_path + '\0'
            op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT

            result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
            if result != 0:
                raise Exception(f"SHFileOperation failed with code {result}")
            logging.info(f"Moved to Recycle Bin (fallback): {folder_path}")
        except Exception as fallback_err:
            raise Exception(f"Cannot move to Recycle Bin: {fallback_err}")

    # Clean up empty client folder if couple was deleted
    if couple_name:
        client_folder = os.path.join(target_path, client_name)
        if os.path.exists(client_folder) and not os.listdir(client_folder):
            os.rmdir(client_folder)
            logging.info(f"Removed empty client folder: {client_folder}")

    api_patch(config, 'download-commands', {
        'id': cmd_id, 'status': 'completed'
    })

    logging.info(f"Delete completed: {drive_label}/{client_name}/{couple_name}")

    # Immediately rescan and sync the drive so portal updates right away
    try:
        drive_info = known_drives.get(drive_label)
        if drive_info:
            drive_path = drive_info.get('path') or drive_info.get('letter') or target_path
            logging.info(f"Triggering immediate rescan of {drive_label} after delete...")
            clients_after = scan_drive_folders(drive_path, force_full=True)
            rescan_drive = {
                'label': drive_label,
                'total': drive_info.get('total', 0),
                'used': drive_info.get('used', 0),
                'free': drive_info.get('free', 0),
                'letter': drive_info.get('letter', ''),
            }
            sync_drive(config, rescan_drive, clients_after)
            logging.info(f"Post-delete rescan and sync complete for {drive_label}")
    except Exception as rescan_err:
        logging.error(f"Post-delete rescan failed (will sync on next cycle): {rescan_err}")


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
        threading.Thread(target=self._resume_interrupted_downloads, daemon=True).start()
        self.status("Drive monitor started")

    def _resume_interrupted_downloads(self):
        """
        On scanner boot, find any project assigned to THIS machine that was
        mid-flight (downloading or copying) and re-enqueue a start_download
        command. The scanner crash or a Windows reboot would have killed the
        in-memory worker thread — the DB row is the only record left.
        """
        try:
            # Small delay so the heartbeat has time to land first.
            time.sleep(5)
            machine = get_machine_name()
            from urllib.parse import quote
            data = api_get(self.config, f'scanner-resume-check?machine={quote(machine)}')
            if not data:
                return
            rows = data.get('projects') or []
            pending_project_ids = set(data.get('pending_project_ids') or [])
            if not rows:
                return

            resumed = 0
            for row in rows:
                pid = row.get('id')
                if not pid or pid in pending_project_ids:
                    continue
                logging.info(
                    f"Resuming interrupted download: {row.get('couple_name')} "
                    f"(status={row.get('download_status')})"
                )
                api_request(self.config, 'download-commands', {
                    'machine_name': machine,
                    'command': 'start_download',
                    'project_id': pid,
                    'payload': {
                        'cloud_folder_path': row.get('cloud_folder_path') or '',
                        'link_type': row.get('link_type') or '',
                        'couple_name': row.get('couple_name') or '',
                        'client_name': row.get('client_name') or 'Unknown',
                        'target_drive': row.get('target_drive') or '',
                    },
                    'status': 'pending',
                })
                resumed += 1
            if resumed:
                logging.info(f"Resume-on-restart: re-queued {resumed} interrupted download(s)")
        except Exception as e:
            logging.error(f"Resume-on-restart failed: {e}")

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

        # Disconnected drives — detect first so reconnect triggers rescan
        for label in list(self.known_drives.keys()):
            if label not in current_labels:
                self.status(f"Drive disconnected: {label}")
                disconnect_drive(self.config, label)
                # Clear last_scan so reconnect triggers immediate rescan
                self.last_scan.pop(label, None)

        # New or reconnected drives
        for drive in current:
            label = drive['label']
            if label not in self.known_drives:
                self.status(f"Drive connected: {label} ({drive['letter']})")
                self._scan_and_sync(drive)

        # Periodic rescan (every scan_interval seconds)
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
