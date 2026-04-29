#!/usr/bin/env bash
# windows-scanner/build.sh — atomic build wrapper for BilalDriveMan-Scanner.exe
#
# WHY THIS EXISTS
# ===============
# We've shipped a broken .exe to main TWICE in one day (3.45.0 hotfix at
# ~04:30 PKT, 3.47.1 hotfix at ~20:00 PKT). Both incidents had the same
# root cause: PyInstaller reused a stale __pycache__ that was compiled
# against the OLD source, so the new .exe self-reported the previous
# VERSION. Auto-update on AAHIL then looped forever:
#   "remote v3.47.1 differs from local v3.47.0, downloading .exe"
#   ... downloads the same broken .exe ...
#   ... restart, still v3.47.0, repeat ...
# Deployed scanners eventually accumulate dozens of zombie processes.
#
# This script is the atomic, idempotent way to build the scanner. ANY
# .exe pushed to main MUST come from this script. If the source bumps
# VERSION, the .exe rebuilds. No exceptions.
#
# WHAT IT DOES
# ============
#   1. Refuses to run if the working tree is dirty (`git status --porcelain`
#      non-empty). Forces commit-then-build so the .exe always matches a
#      committed source revision.
#   2. Nukes every cache PyInstaller might pull from:
#        - windows-scanner/build/
#        - windows-scanner/__pycache__/
#        - any *.spec files left over (we regenerate from CLI flags)
#        - dist/BilalDriveMan-Scanner.exe + .exe.sha256 + .exe.new
#   3. Runs `pyinstaller --onefile --windowed --clean
#                        --hidden-import=wetransfer_provider
#                        drive_scanner.py`
#      (--clean tells PyInstaller to discard its OWN cache too — separate
#       from the rm -rf above which targets *our* caches.)
#   4. Computes SHA256 of the produced .exe and writes
#      dist/BilalDriveMan-Scanner.exe.sha256 with LF line endings.
#   5. Echoes the SHA + the source VERSION it should match, so the human
#      running this can eyeball the result before committing.
#   6. Reminds the human to commit the changed dist/ files in the SAME
#      commit as the source change that bumped VERSION.
#
# USAGE
# =====
#   # On AAHIL, in any shell that has python + bash (Git Bash works):
#   cd /path/to/web-app/windows-scanner
#   ./build.sh
#
#   # Override the python invocation if needed:
#   PY=python3 ./build.sh
#
#   # Skip the dirty-tree check if you're testing the script itself
#   # (NOT for production builds — only for develop/iterate cycles):
#   ALLOW_DIRTY=1 ./build.sh

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
PY="${PY:-python}"
EXE_NAME="BilalDriveMan-Scanner"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"

cd "$SCRIPT_DIR"

# ── 1. Dirty-tree guard ────────────────────────────────────────────────────
# Allow override via ALLOW_DIRTY=1 for iterating on the script itself.
# Production builds should never use that.
if [[ "$ALLOW_DIRTY" != "1" ]]; then
    DIRTY="$(git status --porcelain -- . :../pages :../lib 2>/dev/null || true)"
    if [[ -n "$DIRTY" ]]; then
        echo "ERROR: Working tree is dirty. The .exe must match a committed source revision."
        echo ""
        echo "Uncommitted changes:"
        echo "$DIRTY" | sed 's/^/  /'
        echo ""
        echo "Commit the source changes first, then re-run this script."
        echo "(If you're iterating on this script, set ALLOW_DIRTY=1.)"
        exit 1
    fi
fi

# Capture the source VERSION for echo at the end.
SRC_VERSION="$(grep -E "^VERSION\s*=\s*'[0-9.]+'" drive_scanner.py | head -1 | sed -E "s/.*'([0-9.]+)'.*/\1/")"
if [[ -z "$SRC_VERSION" ]]; then
    echo "ERROR: Could not parse VERSION from drive_scanner.py"
    exit 1
fi

# Capture the current commit so the human can verify what was committed.
COMMIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo 'NO_GIT')"

echo "================================================================"
echo "  BilalDriveMan-Scanner build"
echo "  source VERSION : $SRC_VERSION"
echo "  HEAD commit    : $COMMIT_SHA"
echo "================================================================"

# ── 2. Nuke caches ─────────────────────────────────────────────────────────
echo "[1/4] Nuking caches..."
rm -rf build/ __pycache__/
rm -f -- *.spec
rm -f "dist/$EXE_NAME.exe" "dist/$EXE_NAME.exe.sha256" \
      "dist/$EXE_NAME.exe.new" "dist/$EXE_NAME-update.bat"

# ── 3. Build ───────────────────────────────────────────────────────────────
echo "[2/4] Running PyInstaller (--clean, --onefile, --windowed)..."
"$PY" -m PyInstaller \
    --onefile \
    --windowed \
    --clean \
    --name "$EXE_NAME" \
    --hidden-import=wetransfer_provider \
    --hidden-import=live_progress \
    drive_scanner.py

if [[ ! -f "dist/$EXE_NAME.exe" ]]; then
    echo "ERROR: PyInstaller did not produce dist/$EXE_NAME.exe"
    exit 1
fi

# ── 4. SHA256 sidecar ──────────────────────────────────────────────────────
echo "[3/4] Computing SHA256 + writing sidecar..."
NEW_SHA="$("$PY" -c "import hashlib; print(hashlib.sha256(open('dist/$EXE_NAME.exe','rb').read()).hexdigest())")"

# Write with LF endings (per .gitattributes; CRLF would corrupt the hex on
# downstream curl|read pipelines).
"$PY" -c "open('dist/$EXE_NAME.exe.sha256','w',newline='\n').write('$NEW_SHA' + '\n')"

# ── 5. Report ──────────────────────────────────────────────────────────────
echo "[4/4] Build complete."
echo ""
echo "================================================================"
echo "  source VERSION : $SRC_VERSION"
echo "  HEAD commit    : $COMMIT_SHA"
echo "  output         : dist/$EXE_NAME.exe"
echo "  sidecar        : dist/$EXE_NAME.exe.sha256"
echo "  SHA256         : $NEW_SHA"
echo "================================================================"
echo ""
echo "Next steps:"
echo "  1. git status   # verify dist/$EXE_NAME.exe + .sha256 are modified"
echo "  2. git add windows-scanner/drive_scanner.py \\"
echo "             windows-scanner/dist/$EXE_NAME.exe \\"
echo "             windows-scanner/dist/$EXE_NAME.exe.sha256"
echo "  3. git commit  # IN THE SAME COMMIT as the source change"
echo "  4. git push"
echo ""
echo "DO NOT push the .exe + sidecar without the matching source commit."
echo "DO NOT bump VERSION without re-running this script."
