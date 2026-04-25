"""
Windows Scanner V.3.47.0 - BILAL DRIVE MAN
Runs in system tray, auto-detects external drives,
scans folders (Client > Couple structure), and syncs to the online dashboard.
"""

VERSION = '3.47.0'

import os
import sys
import time
import json
import string
import ctypes
import hashlib
import logging
import subprocess
import threading
import urllib.request
import urllib.error
import urllib.parse
import re as _re
from datetime import datetime

# ─── Auto-Update ─────────────────────────────────────────────────────────────
#
# v3.43.0: the old auto-update path (overwrite __file__, os.execv) didn't work
# for the PyInstaller --onefile build — __file__ inside a frozen bundle points
# to a throwaway extraction dir, not the deployed .exe, so writes didn't
# persist and "updates" just re-ran the same baked-in code.
#
# New flow (batch-shim):
#   1. On startup, fetch the raw drive_scanner.py from GitHub main to peek at
#      the VERSION string. If it matches ours, no update needed.
#   2. If it's different, fetch the expected SHA256 of the new .exe from
#      `<dist>/BilalDriveMan-Scanner.exe.sha256` (a sibling text file in the
#      same repo path).
#   3. Download the new .exe as `BilalDriveMan-Scanner.exe.new` next to the
#      running .exe. Verify its SHA256 matches step-2's expected value.
#   4. If verified, write an `update.bat` that: waits for our PID to exit,
#      renames .new → .exe, relaunches the .exe, deletes itself. Then kick
#      the .bat and exit.
#   5. If SHA mismatch OR download fails, log and keep running current
#      version — safer to run an outdated .exe than to brick a PC with a
#      corrupt binary.
#   6. Best-effort cleanup on startup: if a `.exe.new` is left over from an
#      unclean shutdown, delete it before deciding whether to re-download.
#
# Frozen-exe path resolution: sys.executable inside a PyInstaller onefile is
# the installed .exe path, not the extracted-temp .py. That's what we use.

GITHUB_RAW_URL = 'https://raw.githubusercontent.com/zainansari81-art/bilal-drive-man/main/windows-scanner/drive_scanner.py'
GITHUB_EXE_URL = 'https://raw.githubusercontent.com/zainansari81-art/bilal-drive-man/main/windows-scanner/dist/BilalDriveMan-Scanner.exe'
GITHUB_EXE_SHA_URL = 'https://raw.githubusercontent.com/zainansari81-art/bilal-drive-man/main/windows-scanner/dist/BilalDriveMan-Scanner.exe.sha256'


def _get_installed_exe_path():
    """Return the path of the currently running installed .exe.

    For a PyInstaller onefile build, sys.executable points to the installed
    .exe. For bare `python drive_scanner.py` runs (dev mode), sys.executable
    is the python interpreter — auto-update is a no-op in that case and
    returns None.
    """
    # getattr(sys, 'frozen') is set by PyInstaller; check it before trusting
    # sys.executable as the scanner binary.
    if not getattr(sys, 'frozen', False):
        return None
    exe_path = os.path.abspath(sys.executable)
    if exe_path.lower().endswith('.exe'):
        return exe_path
    return None


def _remote_version():
    """Peek at VERSION in the GitHub raw drive_scanner.py."""
    try:
        req = urllib.request.Request(GITHUB_RAW_URL)
        req.add_header('Cache-Control', 'no-cache')
        with urllib.request.urlopen(req, timeout=15) as resp:
            source = resp.read().decode('utf-8')
        m = _re.search(r"^VERSION\s*=\s*'([^']+)'", source, _re.MULTILINE)
        return m.group(1) if m else None
    except Exception as e:
        logging.warning(f"Auto-update: couldn't read remote VERSION: {e}")
        return None


def _sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def auto_update():
    """Self-replace via batch shim if a newer scanner .exe is on GitHub."""
    exe_path = _get_installed_exe_path()
    if not exe_path:
        # Dev/unfrozen run — skip.
        return

    new_path = exe_path + '.new'

    # Best-effort cleanup from any prior unclean shutdown.
    if os.path.exists(new_path):
        try:
            os.remove(new_path)
        except OSError:
            pass

    remote_ver = _remote_version()
    if not remote_ver:
        return  # Couldn't reach GitHub; just run what we have.
    if remote_ver == VERSION:
        return  # Up to date.

    try:
        # Fetch expected SHA of the remote exe first — if we can't get it,
        # don't risk replacing the binary.
        sha_req = urllib.request.Request(GITHUB_EXE_SHA_URL)
        sha_req.add_header('Cache-Control', 'no-cache')
        with urllib.request.urlopen(sha_req, timeout=15) as resp:
            expected_sha = resp.read().decode('utf-8').strip().lower().split()[0]
        if not _re.fullmatch(r'[a-f0-9]{64}', expected_sha):
            logging.warning(f"Auto-update: bad SHA sidecar content, aborting update")
            return

        # Fetch the .exe.
        logging.info(f"Auto-update: remote v{remote_ver} differs from local v{VERSION}, downloading .exe")
        exe_req = urllib.request.Request(GITHUB_EXE_URL)
        exe_req.add_header('Cache-Control', 'no-cache')
        with urllib.request.urlopen(exe_req, timeout=300) as resp:
            with open(new_path, 'wb') as out:
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)

        # Verify.
        got_sha = _sha256_file(new_path)
        if got_sha != expected_sha:
            logging.error(
                f"Auto-update: SHA256 mismatch (expected {expected_sha}, "
                f"got {got_sha}), aborting replace to avoid bricking the PC"
            )
            try:
                os.remove(new_path)
            except OSError:
                pass
            return

        # Write the shim bat. `timeout /t 3 /nobreak` gives us time to exit.
        exe_dir = os.path.dirname(exe_path)
        bat_path = os.path.join(exe_dir, 'BilalDriveMan-Scanner-update.bat')
        with open(bat_path, 'w') as b:
            b.write(
                '@echo off\r\n'
                'timeout /t 3 /nobreak > nul\r\n'
                f'move /Y "{new_path}" "{exe_path}" > nul 2>&1\r\n'
                f'start "" "{exe_path}"\r\n'
                '(goto) 2>nul & del "%~f0"\r\n'
            )

        logging.info(f"Auto-update: launching shim, exiting to let it replace exe")
        # DETACHED_PROCESS so the bat survives our exit. creationflags=0x00000008.
        subprocess.Popen(
            ['cmd.exe', '/c', bat_path],
            creationflags=0x00000008 | 0x00000200,  # DETACHED | NEW_PROCESS_GROUP
            close_fds=True,
            cwd=exe_dir,
        )
        sys.exit(0)

    except Exception as e:
        logging.error(f"Auto-update failed (continuing on current version): {e}")
        # If we left a partial .new around, clean it up best-effort.
        if os.path.exists(new_path):
            try:
                os.remove(new_path)
            except OSError:
                pass


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
    """Pin a cloud file for offline access (forces download from cloud).

    Two-step fallback strategy:
    1. SetFileAttributesW with FILE_ATTRIBUTE_PINNED — works on legacy
       Dropbox Smart Sync placeholders and on OneDrive's older sync model.
    2. If that didn't clear RECALL_ON_DATA_ACCESS after a short wait, force
       hydration by opening the file and reading a single byte. This
       triggers the Windows Cloud Files Provider RECALL flow used by
       modern Dropbox + OneDrive + iCloud placeholders, where the PINNED
       attribute is silently ignored by the provider. The read blocks
       until the file is fully materialized locally.

    A proper fix is CfSetPinState from cfapi.h — deferred; the 1-byte-read
    workaround is sufficient for wedding-photo workloads and doesn't add
    a cfapi DLL dependency.

    Returns True if pin attempt completed (attribute-set OR read triggered
    without error), False on hard failure.
    """
    try:
        # Step 1: try the attribute-set path first. Cheap, no I/O if it works.
        attrs = ctypes.windll.kernel32.GetFileAttributesW(filepath)
        if attrs == -1:
            return False
        new_attrs = (attrs | FILE_ATTRIBUTE_PINNED) & ~FILE_ATTRIBUTE_UNPINNED
        ctypes.windll.kernel32.SetFileAttributesW(filepath, new_attrs)

        # Only do the expensive read-to-trigger fallback on regular files —
        # directories don't hydrate, and attempting to OpenRead them raises.
        if os.path.isdir(filepath):
            return True

        # Step 2: check whether the attribute-set actually dropped the RECALL
        # bit. On Cloud Files Provider items it won't, and we need to force
        # hydration ourselves.
        attrs_after = ctypes.windll.kernel32.GetFileAttributesW(filepath)
        if attrs_after != -1 and not (attrs_after & FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS):
            return True  # Already offline-material — nothing else to do.

        # The read is blocking for the duration of the cloud fetch, which for
        # a multi-GB file can be many minutes. That's the whole point — we
        # want the scanner's subsequent check_folder_offline_status poll to
        # actually see files hydrated instead of spinning forever against a
        # placeholder tree. Use a short read; Dropbox/OneDrive/iCloud all
        # hydrate the full file on any read, not just the range read.
        try:
            with open(filepath, 'rb') as f:
                f.read(1)
            logging.info(f"Hydrated via 1-byte read: {filepath}")
        except (OSError, PermissionError) as read_err:
            logging.warning(
                f"Hydration read failed for {filepath}: {read_err}"
            )
            return False
        return True
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


# ─── GDrive direct-download (v3.46.0) ───────────────────────────────────────
#
# v3.45.0 and earlier used the Drive shortcut API (files.create with
# mimeType=shortcut) to "add to my Drive", relying on the Drive desktop
# client to materialize the shortcut contents locally. This had two problems:
#   - shortcuts to shared folders only sync the top-level marker, not file
#     contents, so the cloud_folder_path wait-and-poll would time out
#   - required the Drive desktop client to be running on the target PC
#
# v3.46.0 replaces this with direct-download via Drive API to a local
# staging directory (%LOCALAPPDATA%/BilalDriveMan/gdrive-staging/<project_id>/).
# The staging path becomes the cloud_folder_path — downstream code
# (handle_start_download -> handle_copy_to_drive) treats it like any other
# cloud folder and copies from there to the target drive.
# `handle_copy_to_drive` cleans up the staging dir after successful copy.
#
# Concurrency + resilience:
#   - 6 concurrent downloads via ThreadPoolExecutor (middle of Mac's 4-8 band)
#   - Per-file: exp backoff 2s/4s/8s + jitter on 403 userRateLimitExceeded/429
#   - 404 on a file: skip + record in failed_files, don't abort project
#   - Google Apps natives (Docs/Sheets/Slides): try files.export, else skip
#   - .staging-state.json tracks completed_files + failed_files for crash-resume
#   - Streaming 8MB chunks via Range header so a network drop mid-file can
#     resume within the same attempt instead of restarting the whole file
#
# Cancel integration: worker checks `cancel_evt` between chunks and between
# files. On cancel, in-flight chunks finish (cooperative), pending futures
# are cancelled, state is persisted with completed_files preserved so the
# next retry doesn't re-download them.

GDRIVE_STAGING_ROOT = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.join(os.environ.get('USERPROFILE', ''), 'AppData', 'Local')),
    'BilalDriveMan',
    'gdrive-staging',
)
GDRIVE_MAX_CONCURRENT = 6
GDRIVE_RETRY_MAX = 3
GDRIVE_RETRY_BASE = 2.0
GDRIVE_CHUNK_BYTES = 8 * 1024 * 1024  # 8MB


def _extract_gdrive_folder_id(shared_link):
    """Extract folder/file ID from any of Google's share-link formats."""
    import re
    patterns = [
        r'/folders/([a-zA-Z0-9_-]+)',            # /drive/folders/ID, /drive/u/0/folders/ID
        r'/file/d/([a-zA-Z0-9_-]+)',             # /file/d/ID/view
        r'/d/([a-zA-Z0-9_-]+)',                  # /d/ID (docs etc.)
        r'[?&]id=([a-zA-Z0-9_-]+)',              # ?id=ID
    ]
    for pat in patterns:
        m = re.search(pat, shared_link)
        if m:
            return m.group(1)
    raise Exception("Could not extract file/folder ID from Google Drive link")


def _gdrive_staging_dir(project_id):
    """Absolute path to this project's staging directory. Creates parent dirs."""
    safe_id = ''.join(c for c in (project_id or 'unknown') if c.isalnum() or c in '-_')
    d = os.path.join(GDRIVE_STAGING_ROOT, safe_id)
    os.makedirs(d, exist_ok=True)
    return d


def _staging_state_path(staging_dir):
    return os.path.join(staging_dir, '.staging-state.json')


def _staging_state_read(staging_dir):
    """Read staging state, returning empty-shell dict if missing/corrupt."""
    p = _staging_state_path(staging_dir)
    if not os.path.exists(p):
        return None
    try:
        with open(p, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _staging_state_write(staging_dir, state):
    """Atomic write of staging state (.tmp + rename) so a crash mid-write
    doesn't leave corrupt JSON."""
    p = _staging_state_path(staging_dir)
    tmp = p + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(state, f, indent=2)
        os.replace(tmp, p)
    except OSError as e:
        logging.warning(f"Failed to persist staging state: {e}")
        try:
            os.remove(tmp)
        except OSError:
            pass


def _cleanup_staging(project_id):
    """Remove the staging directory for a project. Called post-copy-success."""
    import shutil as _sh
    d = os.path.join(GDRIVE_STAGING_ROOT, ''.join(
        c for c in (project_id or 'unknown') if c.isalnum() or c in '-_'
    ))
    if os.path.isdir(d):
        try:
            _sh.rmtree(d, ignore_errors=True)
            logging.info(f"Cleaned up gdrive staging: {d}")
        except Exception as e:
            logging.warning(f"Could not fully clean staging {d}: {e}")


def _gdrive_should_retry(err):
    """True if the error is a transient rate-limit / backend issue worth retrying."""
    if not isinstance(err, urllib.error.HTTPError):
        # Network / connection errors — worth retrying.
        return True
    if err.code in (429, 500, 502, 503, 504):
        return True
    if err.code == 403:
        try:
            body = err.read().decode()
        except Exception:
            body = ''
        reason = body.lower()
        return ('userratelimitexceeded' in reason
                or 'ratelimitexceeded' in reason
                or 'backenderror' in reason)
    return False


def _gdrive_list_recursive(access_token, folder_id):
    """Depth-first list of every non-folder file under folder_id. Returns
    a list of dicts: {id, name, mimeType, size (str or None), rel_path}.
    Handles pagination via pageToken. Skips trashed items."""
    import collections
    headers = {'Authorization': f'Bearer {access_token}'}
    out = []
    # Stack of (folder_id, rel_path_prefix).
    stack = collections.deque([(folder_id, '')])
    visited = set()
    while stack:
        fid, prefix = stack.popleft()
        if fid in visited:
            continue
        visited.add(fid)
        page_token = None
        while True:
            q = f"'{fid}' in parents and trashed=false"
            params = {
                'q': q,
                'fields': 'nextPageToken,files(id,name,mimeType,size,parents)',
                'pageSize': '1000',
                'supportsAllDrives': 'true',
                'includeItemsFromAllDrives': 'true',
            }
            if page_token:
                params['pageToken'] = page_token
            url = 'https://www.googleapis.com/drive/v3/files?' + urllib.parse.urlencode(params)
            req = urllib.request.Request(url, method='GET')
            for k, v in headers.items():
                req.add_header(k, v)
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode())
            except urllib.error.HTTPError as e:
                err_body = e.read().decode() if e.fp else ''
                raise Exception(f"Drive files.list failed ({e.code}): {err_body}")
            for f in data.get('files', []):
                name = f.get('name', 'Unknown')
                mime = f.get('mimeType', '')
                rel = (prefix + '/' + name).lstrip('/') if prefix else name
                if mime == 'application/vnd.google-apps.folder':
                    stack.append((f['id'], rel))
                else:
                    out.append({
                        'id': f['id'],
                        'name': name,
                        'mimeType': mime,
                        'size': f.get('size'),
                        'rel_path': rel,
                    })
            page_token = data.get('nextPageToken')
            if not page_token:
                break
    return out


# MIME types of Google Apps native files that aren't directly downloadable;
# they need files.export with a conversion target mime.
_GDRIVE_EXPORT_MAP = {
    'application/vnd.google-apps.document': (
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.docx',
    ),
    'application/vnd.google-apps.spreadsheet': (
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xlsx',
    ),
    'application/vnd.google-apps.presentation': (
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.pptx',
    ),
    'application/vnd.google-apps.drawing': ('application/pdf', '.pdf'),
}


def _gdrive_download_one(access_token, file_meta, dest_path, cancel_check):
    """Download a single file to dest_path. Returns bytes written.
    Handles Google Apps native types via files.export. Streaming writes so
    a single giant file doesn't blow memory. cancel_check() should raise
    CancelledError if the user cancelled."""
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    mime = file_meta.get('mimeType', '')
    headers = {'Authorization': f'Bearer {access_token}'}

    if mime in _GDRIVE_EXPORT_MAP:
        export_mime, ext = _GDRIVE_EXPORT_MAP[mime]
        # Rewrite dest_path to include the export extension so the file
        # actually opens on Windows. Preserve the original base name.
        if not dest_path.lower().endswith(ext):
            dest_path = dest_path + ext
        params = urllib.parse.urlencode({'mimeType': export_mime})
        url = f"https://www.googleapis.com/drive/v3/files/{file_meta['id']}/export?{params}"
    elif mime.startswith('application/vnd.google-apps.'):
        # Exotic Google-native type (Form, Sites, etc.) — cannot download.
        raise Exception(f"Unsupported Google Apps mime: {mime}")
    else:
        params = urllib.parse.urlencode({
            'alt': 'media',
            'supportsAllDrives': 'true',
        })
        url = f"https://www.googleapis.com/drive/v3/files/{file_meta['id']}?{params}"

    req = urllib.request.Request(url, method='GET')
    for k, v in headers.items():
        req.add_header(k, v)

    bytes_written = 0
    # 300s read timeout per chunk is generous but videos can stall briefly
    # while Google's CDN warms up.
    with urllib.request.urlopen(req, timeout=300) as resp:
        with open(dest_path, 'wb') as out:
            while True:
                cancel_check()
                chunk = resp.read(GDRIVE_CHUNK_BYTES)
                if not chunk:
                    break
                out.write(chunk)
                bytes_written += len(chunk)
    return bytes_written


def add_gdrive_shared_folder(access_token, shared_link, project_id=None, cancel_evt=None, config=None):
    """v3.46.0: direct-download a shared Google Drive folder to a local
    staging directory. Returns the absolute path of the staging directory
    (not the folder name) — caller persists it as cloud_folder_path so
    downstream handle_start_download / handle_copy_to_drive operate on it
    directly without a find_cloud_folder substring match.

    Idempotent via .staging-state.json: if a prior run left state=complete,
    returns the existing staging path without re-downloading.

    Not backward-compatible with the 3.45.0 shortcut signature
    (access_token, shared_link) -> folder_name. Caller (handle_add_to_cloud)
    is updated in the same PR to pass project_id + cancel_evt and interpret
    the absolute-path return value."""
    file_id = _extract_gdrive_folder_id(shared_link)

    # Resolve the root via files.get so we catch 404/403 fast, and to learn
    # whether the share is a folder or a single file.
    headers = {'Authorization': f'Bearer {access_token}'}
    meta_url = (
        f'https://www.googleapis.com/drive/v3/files/{file_id}'
        '?fields=id,name,mimeType,size&supportsAllDrives=true'
    )
    meta_req = urllib.request.Request(meta_url, method='GET')
    for k, v in headers.items():
        meta_req.add_header(k, v)
    try:
        with urllib.request.urlopen(meta_req, timeout=30) as resp:
            root_meta = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ''
        raise Exception(f"Drive root metadata fetch failed ({e.code}): {err_body}")

    staging_dir = _gdrive_staging_dir(project_id)
    state = _staging_state_read(staging_dir)

    # Idempotent short-circuit.
    if state and state.get('state') == 'complete' and state.get('folder_id') == file_id:
        logging.info(f"gdrive staging already complete for {project_id}: {staging_dir}")
        return staging_dir

    is_folder = root_meta.get('mimeType') == 'application/vnd.google-apps.folder'

    # Cancel helper — raises CancelledError if the user cancelled the project.
    def _cancel_check():
        if cancel_evt is not None and cancel_evt.is_set():
            raise CancelledError(f"gdrive download cancelled for {project_id}")

    if not is_folder:
        # Single-file share — download directly as <staging>/<name>.
        files = [{
            'id': root_meta['id'],
            'name': root_meta.get('name', 'Unknown'),
            'mimeType': root_meta.get('mimeType', ''),
            'size': root_meta.get('size'),
            'rel_path': root_meta.get('name', 'Unknown'),
        }]
    else:
        logging.info(f"Listing gdrive folder '{root_meta.get('name')}' recursively...")
        files = _gdrive_list_recursive(access_token, file_id)

    # v3.46.0 refinement (Mac): sum up total_bytes_expected so portal
    # download_progress can emit bytes_done/bytes_total for mid-file
    # rendering. Google Apps native types have no 'size' field so they're
    # counted as 0 in the expected total — portal's bytes_done will still
    # be accurate (sum of bytes actually written).
    total_bytes_expected = 0
    for fm in files:
        sz = fm.get('size')
        if sz is not None:
            try:
                total_bytes_expected += int(sz)
            except (TypeError, ValueError):
                pass

    # Fresh or partially-complete state.
    if not state or state.get('folder_id') != file_id:
        state = {
            'project_id': project_id,
            'folder_id': file_id,
            'root_name': root_meta.get('name'),
            'started_at': datetime.utcnow().isoformat() + 'Z',
            'completed_files': {},
            'failed_files': {},
            'total_expected': len(files),
            'total_bytes_expected': total_bytes_expected,
            'state': 'downloading',
        }
    else:
        state['state'] = 'downloading'
        state['total_expected'] = len(files)
        state['total_bytes_expected'] = total_bytes_expected
    _staging_state_write(staging_dir, state)

    # v3.46.1: report initial phase + total_bytes_expected so the portal can
    # render the progress bar before the first file completes. Best-effort —
    # no config means we're under a caller that didn't pass one (shouldn't
    # happen in production, but don't blow up listing just for telemetry).
    if project_id and config is not None:
        try:
            api_request(config, 'download-progress', {
                'project_id': project_id,
                'status': 'downloading',
                'phase': 'gdrive_staging',
                'progress_bytes': 0,
                'total_bytes_expected': total_bytes_expected,
            })
        except Exception as e:
            logging.warning(f"Initial gdrive_staging progress emit failed: {e}")

    completed = state.setdefault('completed_files', {})
    failed = state.setdefault('failed_files', {})

    # ThreadPoolExecutor with bounded concurrency. Futures hold (file_meta,
    # dest_path) for error reporting.
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import random

    def _download_task(file_meta):
        fid = file_meta['id']
        # Already done from prior run? Skip fast.
        if fid in completed:
            return ('skipped', fid, completed[fid].get('size', 0))
        rel = file_meta['rel_path']
        # Normalize to OS separators, refuse path traversal.
        rel_os = rel.replace('/', os.sep).replace('\\', os.sep)
        dest = os.path.normpath(os.path.join(staging_dir, rel_os))
        real_staging = os.path.realpath(staging_dir)
        real_dest = os.path.realpath(os.path.dirname(dest))
        if not real_dest.startswith(real_staging):
            return ('failed', fid, 'path_traversal_detected')

        last_err = None
        for attempt in range(GDRIVE_RETRY_MAX):
            try:
                _cancel_check()
                written = _gdrive_download_one(access_token, file_meta, dest, _cancel_check)
                return ('ok', fid, written, dest)
            except CancelledError:
                raise
            except urllib.error.HTTPError as e:
                last_err = e
                if e.code == 404:
                    return ('failed', fid, 'file_gone')
                if e.code == 403:
                    try:
                        body = e.read().decode()
                    except Exception:
                        body = ''
                    if 'cannotdownloadfile' in body.lower():
                        return ('failed', fid, 'cannot_download_native_type')
                if not _gdrive_should_retry(e):
                    return ('failed', fid, f'http_{e.code}')
            except Exception as e:
                last_err = e
            # Backoff before next attempt.
            if attempt < GDRIVE_RETRY_MAX - 1:
                sleep = GDRIVE_RETRY_BASE * (2 ** attempt) + random.uniform(0, 0.5)
                time.sleep(sleep)
        return ('failed', fid, f'retries_exhausted: {last_err}')

    with ThreadPoolExecutor(max_workers=GDRIVE_MAX_CONCURRENT) as ex:
        futures = {ex.submit(_download_task, fm): fm for fm in files}
        done_count = 0
        total_bytes = 0
        for fut in as_completed(futures):
            try:
                result = fut.result()
            except CancelledError:
                # Cancel all still-pending futures and bubble up.
                for other in futures:
                    other.cancel()
                state['state'] = 'cancelled'
                _staging_state_write(staging_dir, state)
                raise
            status = result[0]
            fid = result[1]
            if status == 'ok':
                written = result[2]
                dest = result[3]
                completed[fid] = {'path': dest, 'size': written}
                total_bytes += written
            elif status == 'skipped':
                total_bytes += result[2]
            else:  # failed
                reason = result[2]
                existing = failed.get(fid, {})
                failed[fid] = {
                    'reason': reason,
                    'attempts': (existing.get('attempts', 0) or 0) + 1,
                }
                logging.warning(f"gdrive file {fid} failed: {reason}")
            done_count += 1
            state['bytes_done'] = total_bytes
            # Persist every 5 files to bound data-loss on a mid-run crash.
            if done_count % 5 == 0:
                _staging_state_write(staging_dir, state)
            # v3.46.1: emit bytes_done progress on every completion so the
            # portal progress bar updates in near-realtime. Cheap call, the
            # api_request path is already fire-and-forget.
            if project_id and config is not None:
                try:
                    api_request(config, 'download-progress', {
                        'project_id': project_id,
                        'status': 'downloading',
                        'phase': 'gdrive_staging',
                        'progress_bytes': total_bytes,
                        'total_bytes_expected': total_bytes_expected,
                    })
                except Exception:
                    # Telemetry failures are non-fatal to the download.
                    pass

    # Flush final state.
    if not failed:
        state['state'] = 'complete'
    else:
        # Complete-with-errors: we still return the dir but leave state as
        # 'downloading_with_failures' so observers (and a future retry) know
        # some files are missing. copy_to_drive will still copy what's there.
        state['state'] = 'complete_with_failures'
    state['completed_files'] = completed
    state['failed_files'] = failed
    _staging_state_write(staging_dir, state)

    logging.info(
        f"gdrive direct-download done: {len(completed)} files ok, "
        f"{len(failed)} failed, staging={staging_dir}"
    )
    return staging_dir


# ─── WeTransfer direct-download (v3.47.0) ──────────────────────────────────
#
# v3.47.0 lifts the WeTransfer primitives Mac-Claude pre-shipped in
# `wetransfer_provider.py` (commit 4666ae4) and wires them through the same
# parallel staging pattern as gdrive (v3.46.0). Shares: staging dir layout,
# `.staging-state.json` atomic write, ThreadPoolExecutor(6), cancel-event
# honor, download-progress telemetry (gdrive_staging phase + bytes_done /
# total_bytes_expected from 3.46.1).
#
# Removes the `raise Exception('WeTransfer handler coming in scanner 3.47.0')`
# guard that was added to `handle_add_to_cloud` in 3.46.0 as a stop-gap
# after Mac's `a0b95ff` un-blocked WeTransfer portal-side.
#
# Staging lives in a distinct root from gdrive so the post-copy cleanup
# hook in `handle_copy_to_drive` knows which tree to rmtree.

import wetransfer_provider as _wt

WETRANSFER_STAGING_ROOT = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.join(os.environ.get('USERPROFILE', ''), 'AppData', 'Local')),
    'BilalDriveMan',
    'wetransfer-staging',
)
WETRANSFER_MAX_CONCURRENT = 6


def _wetransfer_staging_dir(project_id):
    safe_id = ''.join(c for c in (project_id or 'unknown') if c.isalnum() or c in '-_')
    d = os.path.join(WETRANSFER_STAGING_ROOT, safe_id)
    os.makedirs(d, exist_ok=True)
    return d


def _wetransfer_cleanup_staging(project_id):
    """Mirror of _cleanup_staging for the wetransfer root. Called post-copy."""
    import shutil as _sh
    safe_id = ''.join(c for c in (project_id or 'unknown') if c.isalnum() or c in '-_')
    d = os.path.join(WETRANSFER_STAGING_ROOT, safe_id)
    if os.path.isdir(d):
        try:
            _sh.rmtree(d, ignore_errors=True)
            logging.info(f"Cleaned up wetransfer staging: {d}")
        except Exception as e:
            logging.warning(f"Could not fully clean wetransfer staging {d}: {e}")


def add_wetransfer_share(download_link, project_id=None, cancel_evt=None, config=None):
    """v3.47.0: direct-download a WeTransfer share to a local staging dir.

    Returns absolute staging dir path (for cloud_folder_path) — same
    contract as `add_gdrive_shared_folder`. Idempotent via
    `.staging-state.json`. Parallel downloads via ThreadPoolExecutor(6).
    Telemetry: emits `gdrive_staging` phase (reused — the portal treats
    both gdrive + wetransfer as "downloading to local staging" visually)
    with progress_bytes + total_bytes_expected on every file completion.
    """
    # 1. URL parsing / short-link resolution.
    transfer_id, security_hash, is_short = _wt.extract_transfer_ids(download_link)
    if is_short:
        canonical = _wt.resolve_short_link(download_link)
        if not canonical:
            raise Exception('WeTransfer short link could not be resolved (expired or invalid)')
        transfer_id, security_hash, _ = _wt.extract_transfer_ids(canonical)
    if not transfer_id or not security_hash:
        raise Exception(f'Could not extract WeTransfer transfer_id/security_hash from: {download_link}')

    # 2. prepare-download → enumerate items. Strip folder entries (we
    # reconstruct folder structure from file item names' slashes).
    try:
        meta = _wt.prepare_download(transfer_id, security_hash)
    except urllib.error.HTTPError as e:
        code = e.code
        if code in (403, 404, 410):
            raise Exception(f'WeTransfer share unavailable ({code}) — expired, removed, or security_hash rejected')
        raise
    items = [it for it in (meta.get('items') or []) if it.get('content_identifier') != 'folder']
    if not items:
        raise Exception('WeTransfer share has no downloadable files (empty or all folders)')

    staging_dir = _wetransfer_staging_dir(project_id)
    state = _staging_state_read(staging_dir)

    # Idempotent short-circuit: if we already downloaded this same transfer
    # (transfer_id match), return the cached staging dir.
    if state and state.get('state') == 'complete' and state.get('transfer_id') == transfer_id:
        logging.info(f"wetransfer staging already complete for {project_id}: {staging_dir}")
        return staging_dir

    # Compute totals up front for portal telemetry.
    total_bytes_expected = 0
    for it in items:
        sz = it.get('size')
        if sz is not None:
            try:
                total_bytes_expected += int(sz)
            except (TypeError, ValueError):
                pass

    # Fresh / partially-complete state.
    if not state or state.get('transfer_id') != transfer_id:
        state = {
            'project_id': project_id,
            'provider': 'wetransfer',
            'transfer_id': transfer_id,
            'started_at': datetime.utcnow().isoformat() + 'Z',
            'completed_files': {},
            'failed_files': {},
            'total_expected': len(items),
            'total_bytes_expected': total_bytes_expected,
            'state': 'downloading',
        }
    else:
        state['state'] = 'downloading'
        state['total_expected'] = len(items)
        state['total_bytes_expected'] = total_bytes_expected
    _staging_state_write(staging_dir, state)

    # Emit initial progress so the portal bar renders before file 1 lands.
    if project_id and config is not None:
        try:
            api_request(config, 'download-progress', {
                'project_id': project_id,
                'status': 'downloading',
                'phase': 'gdrive_staging',  # reused phase string; same UX
                'progress_bytes': 0,
                'total_bytes_expected': total_bytes_expected,
            })
        except Exception as e:
            logging.warning(f"Initial wetransfer progress emit failed: {e}")

    completed = state.setdefault('completed_files', {})
    failed = state.setdefault('failed_files', {})

    def _cancel_check():
        if cancel_evt is not None and cancel_evt.is_set():
            raise CancelledError(f"wetransfer download cancelled for {project_id}")

    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _download_task(item):
        fid = item['id']
        if fid in completed:
            return ('skipped', fid, completed[fid].get('size', 0))

        # WeTransfer file names may contain forward slashes encoding folder
        # structure — preserve them by mapping to OS separators.
        raw_name = item.get('name') or f'file-{fid}'
        # Split on '/' so we can sanitize each segment without losing hierarchy.
        segments = [_wt._sanitize_filename(seg) for seg in raw_name.split('/') if seg]
        if not segments:
            segments = ['unnamed_file']
        rel_os = os.sep.join(segments)
        dest = os.path.normpath(os.path.join(staging_dir, rel_os))

        # Path-traversal guard.
        real_staging = os.path.realpath(staging_dir)
        real_dest = os.path.realpath(os.path.dirname(dest))
        if not real_dest.startswith(real_staging):
            return ('failed', fid, 'path_traversal_detected')

        os.makedirs(os.path.dirname(dest), exist_ok=True)
        expected_size = item.get('size')
        try:
            expected_size = int(expected_size) if expected_size is not None else None
        except (TypeError, ValueError):
            expected_size = None

        # Skip if already complete (disk has it with correct size).
        if expected_size is not None and os.path.exists(dest) and os.path.getsize(dest) == expected_size:
            return ('ok', fid, expected_size, dest)

        # `stream_download` handles Range-resumable retries + mid-download
        # direct_link refresh + cancel cooperatively. We feed it a closure
        # so the 5-min presigned URL can be re-minted without leaving the
        # function.
        def _refresh_url(tid=transfer_id, sh=security_hash, id_=fid):
            return _wt.request_file_download_url(tid, sh, id_)

        try:
            direct_link = _refresh_url()
            if not direct_link:
                return ('failed', fid, 'no_direct_link')
            _wt.stream_download(
                direct_link, dest,
                expected_size=expected_size,
                cancel_check=_cancel_check,
                refresh_url_fn=_refresh_url,
            )
        except CancelledError:
            raise
        except urllib.error.HTTPError as e:
            if e.code in (403, 404, 410):
                return ('failed', fid, f'http_{e.code}')
            return ('failed', fid, f'http_{e.code}')
        except Exception as e:
            return ('failed', fid, f'{type(e).__name__}: {e}')

        bytes_written = os.path.getsize(dest) if os.path.exists(dest) else 0
        return ('ok', fid, bytes_written, dest)

    with ThreadPoolExecutor(max_workers=WETRANSFER_MAX_CONCURRENT) as ex:
        futures = {ex.submit(_download_task, it): it for it in items}
        done_count = 0
        total_bytes = 0
        for fut in as_completed(futures):
            try:
                result = fut.result()
            except CancelledError:
                for other in futures:
                    other.cancel()
                state['state'] = 'cancelled'
                _staging_state_write(staging_dir, state)
                raise
            status = result[0]
            fid = result[1]
            if status == 'ok':
                written = result[2]
                dest = result[3]
                completed[fid] = {'path': dest, 'size': written}
                total_bytes += written
            elif status == 'skipped':
                total_bytes += result[2]
            else:
                reason = result[2]
                existing = failed.get(fid, {})
                failed[fid] = {
                    'reason': reason,
                    'attempts': (existing.get('attempts', 0) or 0) + 1,
                }
                logging.warning(f"wetransfer file {fid} failed: {reason}")
            done_count += 1
            state['bytes_done'] = total_bytes
            if done_count % 5 == 0:
                _staging_state_write(staging_dir, state)
            if project_id and config is not None:
                try:
                    api_request(config, 'download-progress', {
                        'project_id': project_id,
                        'status': 'downloading',
                        'phase': 'gdrive_staging',
                        'progress_bytes': total_bytes,
                        'total_bytes_expected': total_bytes_expected,
                    })
                except Exception:
                    pass

    if not failed:
        state['state'] = 'complete'
    else:
        state['state'] = 'complete_with_failures'
    state['completed_files'] = completed
    state['failed_files'] = failed
    _staging_state_write(staging_dir, state)

    logging.info(
        f"wetransfer direct-download done: {len(completed)} files ok, "
        f"{len(failed)} failed, staging={staging_dir}"
    )
    return staging_dir


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

# ─── Handler registry (v3.45.0) ─────────────────────────────────────────────
#
# v3.45.0 gap-fix #1 (dedupe concurrent handlers) + gap-fix #9 (cooperative
# cancellation). Keyed on (project_id, command) per Mac-Claude's note: two
# different commands for the same project (e.g. add_to_cloud + start_download
# enqueued back-to-back) are *legitimate* concurrency. Only same-(project,
# command) pairs are the racing case observed in the 2026-04-25 E2E (two
# start_download threads racing on copy_to_drive, WinError 32 on file lock).
#
# Cancel events are keyed on project_id only (cancel applies to every handler
# touching that project). The event is lazily created on first handler register
# and cleared once no handler for that project is active.
_HANDLER_LOCK = threading.Lock()
_ACTIVE_HANDLERS = set()        # {(project_id, command)} currently running
_CANCEL_EVENTS = {}             # {project_id: threading.Event}


def _register_handler(project_id, command):
    """Atomically claim a (project_id, command) slot.

    Returns (True, cancel_event) if this is the first handler for the pair —
    caller MUST call _unregister_handler when finished.
    Returns (False, None) if another thread is already handling the same pair.
    """
    with _HANDLER_LOCK:
        key = (project_id, command)
        if key in _ACTIVE_HANDLERS:
            return False, None
        _ACTIVE_HANDLERS.add(key)
        evt = _CANCEL_EVENTS.get(project_id)
        if evt is None:
            evt = threading.Event()
            _CANCEL_EVENTS[project_id] = evt
        return True, evt


def _unregister_handler(project_id, command):
    with _HANDLER_LOCK:
        _ACTIVE_HANDLERS.discard((project_id, command))
        # Reclaim the cancel event once no handler for this project is left.
        still_active = any(k[0] == project_id for k in _ACTIVE_HANDLERS)
        if not still_active:
            _CANCEL_EVENTS.pop(project_id, None)


def _signal_cancel(project_id):
    """Set the cancel event for a project (if any handler is running)."""
    with _HANDLER_LOCK:
        evt = _CANCEL_EVENTS.get(project_id)
    if evt is not None:
        evt.set()


def _get_cancel_event(project_id):
    """Fetch the current cancel event for a project, or None if not tracked."""
    with _HANDLER_LOCK:
        return _CANCEL_EVENTS.get(project_id)


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
            # v3.45.0 gap-fix #1: dedupe concurrent handlers keyed by
            # (project_id, command). Background-thread commands (copy_to_drive,
            # start_download) use _register_handler; foreground commands don't
            # need it because the poll loop is single-threaded.
            if command in ('copy_to_drive', 'start_download') and project_id:
                claimed, _evt = _register_handler(project_id, command)
                if not claimed:
                    logging.warning(
                        f"Skipping duplicate {command} for project {project_id} — "
                        f"another thread is already running it. Acking cmd {cmd_id}."
                    )
                    api_patch(config, 'download-commands', {
                        'id': cmd_id, 'status': 'completed',
                        'error_message': 'Duplicate handler — superseded by in-flight thread',
                    })
                    continue
                # _safe_run_command is responsible for _unregister_handler in finally.

            if command == 'copy_to_drive':
                # Run in background thread to avoid blocking main loop
                threading.Thread(
                    target=_safe_run_command,
                    args=(handle_copy_to_drive, config, project_id, payload, known_drives, cmd_id, command),
                    daemon=True
                ).start()
            elif command == 'start_download':
                # Run in background thread — this monitors cloud folder for hours
                threading.Thread(
                    target=_safe_run_command,
                    args=(handle_start_download, config, project_id, payload, known_drives, cmd_id, command),
                    daemon=True
                ).start()
            elif command == 'delete_data':
                handle_delete_data(config, payload, known_drives, cmd_id)
            elif command == 'add_to_cloud':
                handle_add_to_cloud(config, project_id, payload, cmd_id)
            elif command == 'check_cloud_status':
                handle_check_cloud_status(config, project_id, payload, cmd_id)
            elif command == 'cancel_download':
                # v3.45.0 gap-fix #9: signal any in-flight handler for this
                # project to stop at its next cancel-check boundary. The handler
                # itself will patch the project/command rows on exit.
                if project_id:
                    _signal_cancel(project_id)
                    logging.info(f"Cancel signal raised for project {project_id}")
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


class CancelledError(Exception):
    """Raised by a handler when it observes that the user cancelled the project.
    Caught in _safe_run_command → patches the command row as completed+cancelled
    rather than failed (so the portal can distinguish user-abort from crash)."""
    pass


def _check_cancelled(project_id):
    """Raise CancelledError if the cancel event for this project is set.
    Handlers call this at natural boundaries (between files, between poll ticks)
    so user-initiated cancel_download takes effect without needing thread kill."""
    evt = _get_cancel_event(project_id)
    if evt is not None and evt.is_set():
        raise CancelledError(f"Project {project_id} cancelled by user")


def _safe_run_command(handler, config, project_id, payload, known_drives, cmd_id, command=None):
    """Wrapper to run command handlers in background threads with error handling.

    v3.45.0: unregisters the (project_id, command) dedupe slot in finally so
    a future retry of the same command isn't blocked by a crashed predecessor.
    The `command` arg is optional for backward compatibility with any caller
    that didn't pass it (those paths won't have registered either).
    """
    try:
        handler(config, project_id, payload, known_drives, cmd_id)
    except CancelledError as ce:
        logging.info(f"Handler cancelled for project {project_id}: {ce}")
        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'completed',
            'error_message': 'Cancelled by user',
        })
        api_request(config, 'download-progress', {
            'project_id': project_id,
            'status': 'cancelled',
            'phase': '',
        })
    except Exception as e:
        logging.error(f"Background command failed: {e}")
        api_patch(config, 'download-commands', {
            'id': cmd_id, 'status': 'failed', 'error_message': str(e)[:500]
        })
    finally:
        if command and project_id:
            _unregister_handler(project_id, command)


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
        cloud_folder_abs = None  # v3.46.0: gdrive returns abs path directly
        if link_type == 'wetransfer':
            # v3.47.0: real handler. Uses wetransfer_provider (primitives)
            # + add_wetransfer_share (orchestrator). Returns absolute staging
            # dir path, same contract as gdrive direct-download.
            cancel_evt = _get_cancel_event(project_id)
            cloud_folder_abs = add_wetransfer_share(
                download_link,
                project_id=project_id,
                cancel_evt=cancel_evt,
                config=config,
            )
            try:
                _s = _staging_state_read(cloud_folder_abs)
                folder_name = (_s or {}).get('transfer_id') or os.path.basename(
                    cloud_folder_abs.rstrip(os.sep)
                )
            except Exception:
                folder_name = os.path.basename(cloud_folder_abs.rstrip(os.sep))

        elif link_type == 'dropbox':
            folder_name = call_with_token_retry(
                config, 'dropbox',
                lambda tok: add_dropbox_shared_folder(tok, download_link),
            )
        elif link_type == 'google_drive':
            # v3.46.0: direct-download to staging dir. Grab cancel event so
            # the downloader can abort cooperatively between chunks/files.
            cancel_evt = _get_cancel_event(project_id)
            cloud_folder_abs = call_with_token_retry(
                config, 'google_drive',
                lambda tok: add_gdrive_shared_folder(
                    tok, download_link,
                    project_id=project_id, cancel_evt=cancel_evt,
                    config=config,
                ),
            )
            # folder_name is whatever the leaf directory is named; mostly used
            # for logs. Pull from the root_name we stored in staging state.
            try:
                _s = _staging_state_read(cloud_folder_abs)
                folder_name = (_s or {}).get('root_name') or os.path.basename(
                    cloud_folder_abs.rstrip(os.sep)
                )
            except Exception:
                folder_name = os.path.basename(cloud_folder_abs.rstrip(os.sep))
        else:
            api_patch(config, 'download-commands', {
                'id': cmd_id, 'status': 'failed',
                'error_message': f'Unsupported link_type: {link_type}',
            })
            return

        # Report success — persist the resolved cloud folder's full local
        # path on the project row so start_download can locate the folder
        # directly. For dropbox we construct <dropbox_path>/<folder_name>.
        # For google_drive (v3.46.0+) the staging dir IS the absolute path.
        progress_body = {
            'project_id': project_id,
            'status': 'downloading',
            'phase': 'pinning',
        }
        if cloud_folder_abs:
            # v3.46.0 gdrive direct-download path — absolute already.
            progress_body['cloud_folder_path'] = cloud_folder_abs
        else:
            base = ''
            if link_type == 'dropbox':
                base = config.get('dropbox_path', '')
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

    # v3.45.0 gap-fix #4/#5: cleanup-on-failure semantics. If this handler
    # crashes mid-copy (OSError from drive unplug, disk full, file-lock race),
    # delete the partial dest dir we created so the retry starts from a clean
    # slate rather than mixing stale+new files under `dirs_exist_ok=True`.
    # We only delete what *this handler* could have created — if `dest` already
    # existed on entry (e.g. legitimate prior completed copy), we leave it.
    dest_existed_on_entry = os.path.isdir(dest)
    os.makedirs(dest, exist_ok=True)

    api_request(config, 'download-progress', {
        'project_id': project_id,
        'status': 'copying',
        'progress_bytes': 0,
        'phase': 'copying',
    })

    total_copied = 0
    try:
        if os.path.isdir(source_path):
            for item in os.listdir(source_path):
                # v3.45.0 gap-fix #9: cooperative cancellation at file boundaries.
                # User-initiated cancel_download sets the project's cancel event;
                # we observe it between files. Mid-file cancel is overkill for
                # typical 5-file / 3GB payloads — file-boundary is fine.
                _check_cancelled(project_id)

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
    except CancelledError:
        # User asked to stop. Remove the partial dest we created so the drive
        # doesn't keep orphan files. Re-raise so _safe_run_command marks the
        # command as cancelled (not failed).
        if not dest_existed_on_entry:
            try:
                shutil.rmtree(dest, ignore_errors=True)
                logging.info(f"Removed partial copy dir after cancel: {dest}")
            except Exception as cleanup_err:
                logging.error(f"Partial-dir cleanup after cancel failed: {cleanup_err}")
        raise
    except OSError as copy_err:
        # Drive unplugged, disk full, file-lock race, permission issue, etc.
        # Delete the partial dest so a retry starts from a clean slate.
        if not dest_existed_on_entry:
            try:
                shutil.rmtree(dest, ignore_errors=True)
                logging.info(f"Removed partial copy dir after OSError: {dest}")
            except Exception as cleanup_err:
                logging.error(f"Partial-dir cleanup failed: {cleanup_err}")
        # Re-raise so _safe_run_command marks the command as failed with
        # a meaningful error_message. Category tagging is deferred to PR2 #10.
        raise Exception(f"Copy failed ({type(copy_err).__name__}): {copy_err}")

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

    # v3.46.0/3.47.0: staging cleanup. If the source was under EITHER the
    # gdrive-staging OR wetransfer-staging tree, rmtree it now that the copy
    # succeeded. Frees local disk + prevents stale state files from misleading
    # a future retry. Dropbox folders are managed by the Dropbox client,
    # never cleaned by us.
    try:
        real_source = os.path.realpath(source_path)
        real_gdrive_root = os.path.realpath(GDRIVE_STAGING_ROOT)
        real_wt_root = os.path.realpath(WETRANSFER_STAGING_ROOT)
        if real_source.startswith(real_gdrive_root):
            _cleanup_staging(project_id)
        elif real_source.startswith(real_wt_root):
            _wetransfer_cleanup_staging(project_id)
    except Exception as cleanup_err:
        logging.warning(f"Post-copy staging cleanup check failed: {cleanup_err}")


def handle_start_download(config, project_id, payload, known_drives, cmd_id):
    """
    Monitor a cloud sync folder until files are fully offline, then copy to target drive.
    This is the main download workflow:
    1. Find the cloud folder for this project
    2. Monitor until all files are offline (user marks them for offline in desktop app)
    3. Once ready, auto-copy to the target external drive
    """
    cloud_folder = (payload.get('cloud_folder_path') or '').strip()
    link_type = payload.get('link_type', '')
    couple_name = payload.get('couple_name', '')
    client_name = payload.get('client_name', 'Unknown')
    target_drive_label = payload.get('target_drive', '')

    # v3.44.0 — two code paths here:
    #   (A) Resolved path is set in the payload (upstream add_to_cloud persisted
    #       it via the cloud_folder_path write path shipped in v3.43.0). This is
    #       the truth. If it's not on disk yet, wait up to 90s for Dropbox's
    #       desktop client to materialize it — the "Added to my Dropbox" click
    #       lands cloud-side in seconds but the local-tree propagation has a
    #       10-60s typical lag. Do NOT fall through to find_cloud_folder here —
    #       if the resolved path is correct in Supabase, a couple_name
    #       substring match can only ever produce a worse answer.
    #   (B) No resolved path (legacy commands enqueued before v3.43.0). Fall
    #       through to the historical find_cloud_folder(couple_name) behavior
    #       so older queue entries don't regress.
    if cloud_folder:
        if not os.path.isdir(cloud_folder):
            # Report phase so the UI doesn't show "progress stuck at 0" during
            # the wait.
            api_request(config, 'download-progress', {
                'project_id': project_id,
                'status': 'downloading',
                'phase': 'pinning',
            })
            wait_seconds = 90
            poll_interval = 2
            logging.info(
                f"Waiting up to {wait_seconds}s for Dropbox to materialize "
                f"'{cloud_folder}' locally..."
            )
            start = time.time()
            deadline = start + wait_seconds
            while time.time() < deadline:
                # v3.45.0 gap-fix #9: honor user cancel even during the
                # pre-materialization wait. CancelledError unwinds to
                # _safe_run_command which tags the command 'cancelled'.
                _check_cancelled(project_id)
                if os.path.isdir(cloud_folder):
                    break
                time.sleep(poll_interval)
            if os.path.isdir(cloud_folder):
                elapsed = time.time() - start
                logging.info(
                    f"Cloud folder materialized after {elapsed:.1f}s: "
                    f"{cloud_folder}"
                )
            else:
                err = (
                    f"Resolved cloud folder '{cloud_folder}' not yet synced "
                    f"locally by Dropbox desktop after {wait_seconds}s. "
                    f"Verify Dropbox desktop client is running and has pulled "
                    f"the folder. Folder confirmed in cloud. If the folder "
                    f"was added via the wizard's popup, Dropbox may need "
                    f"manual intervention (tray icon \u2192 force sync, or "
                    f"Dropbox website \u2192 right-click folder \u2192 'Make "
                    f"available offline')."
                )
                logging.error(err)
                api_request(config, 'download-progress', {
                    'project_id': project_id,
                    'status': 'failed',
                    'error_message': err,
                })
                api_patch(config, 'download-commands', {
                    'id': cmd_id, 'status': 'failed',
                    'error_message': err[:500],
                })
                return
    else:
        # Legacy path — pre-v3.43.0 commands have no resolved cloud_folder_path.
        cloud_folder = find_cloud_folder(config, link_type, couple_name)
        if not cloud_folder:
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
        # v3.45.0 gap-fix #9: cancel check at each 30s tick. This is the long
        # wait — most of the download's wall-clock lives here — so cancel
        # responsiveness matters.
        _check_cancelled(project_id)

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
        # v3.45.0 gap-fix #2: reset stale-acked commands BEFORE the resume-check
        # thread fires. Scanner restarts (manual or crash) leave commands in
        # the 'acked' limbo state, which poll_download_commands never re-picks
        # (it only fetches status=pending). Reset them first so the resume
        # flow and the normal poll both see a clean queue.
        threading.Thread(target=self._reset_stale_acked_commands, daemon=True).start()
        threading.Thread(target=self._loop, daemon=True).start()
        threading.Thread(target=self._resume_interrupted_downloads, daemon=True).start()
        self.status("Drive monitor started")

    def _reset_stale_acked_commands(self):
        """v3.45.0 gap-fix #2: on boot, flip this machine's orphaned-acked
        commands (acked >= 60s ago) back to pending so the current boot's poll
        loop picks them up. Server-side (Vercel clock) computes the cutoff so
        we don't have to trust the scanner's clock."""
        try:
            # Tiny delay so the heartbeat has time to land first (helps the
            # backend correlate the reset to a live scanner instance).
            time.sleep(3)
            machine = get_machine_name()
            result = api_request(self.config, 'scanner-reset-stale-acked', {
                'machine_name': machine,
                'threshold_seconds': 60,
            })
            if not result:
                # api_request logs the error; stay silent here to avoid dupe.
                return
            reset = result.get('reset', 0)
            if reset:
                ids = result.get('ids') or []
                logging.info(
                    f"Boot recovery: reset {reset} stale acked commands back "
                    f"to pending ({', '.join(str(i) for i in ids[:5])}"
                    f"{'...' if len(ids) > 5 else ''})"
                )
        except Exception as e:
            logging.error(f"reset-stale-acked on boot failed: {e}")

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
