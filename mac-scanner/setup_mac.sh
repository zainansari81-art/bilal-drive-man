#!/bin/bash
# BD Scanner — Mac setup helper
# Grants Python Full Disk Access and restarts the scanner.
# Run once on each new Mac:
#   bash setup_mac.sh

set -e

RED=$'\033[0;31m'
GRN=$'\033[0;32m'
YLW=$'\033[0;33m'
CYN=$'\033[0;36m'
BLD=$'\033[1m'
RST=$'\033[0m'

echo ""
echo "${BLD}=====================================${RST}"
echo "${BLD}  BD Scanner — Mac Permission Setup  ${RST}"
echo "${BLD}=====================================${RST}"
echo ""

# -------- 1. Locate Python --------
PYTHON_PATH=""
# Prefer the newest Python.framework install
for p in /Library/Frameworks/Python.framework/Versions/*/bin/python3; do
    [ -x "$p" ] && PYTHON_PATH="$p"
done
# Fallbacks
[ -z "$PYTHON_PATH" ] && PYTHON_PATH=$(command -v python3 || true)
[ -z "$PYTHON_PATH" ] && PYTHON_PATH=$(command -v python || true)

if [ -z "$PYTHON_PATH" ]; then
    echo "${RED}ERROR: Python not found. Install Python 3 first from python.org${RST}"
    exit 1
fi

# Resolve symlinks to the real binary (TCC tracks the real path)
REAL_PYTHON=$("$PYTHON_PATH" -c "import sys; print(sys.executable)")
echo "Python binary: ${CYN}${REAL_PYTHON}${RST}"
echo ""

# -------- 2. Test current permission --------
has_fda() {
    # Full Disk Access lets Python read the TCC database itself — good canary
    "$REAL_PYTHON" -c "open('/Library/Application Support/com.apple.TCC/TCC.db','rb').read(1)" 2>/dev/null
}

if has_fda; then
    echo "${GRN}Python already has Full Disk Access. Skipping permission step.${RST}"
    SKIP_PERMISSION=1
else
    SKIP_PERMISSION=0
fi

# -------- 3. Guide user to grant FDA --------
if [ "$SKIP_PERMISSION" = "0" ]; then
    # Copy path to clipboard so user can just paste
    echo -n "$REAL_PYTHON" | pbcopy

    echo "${YLW}Python needs Full Disk Access to read external drives.${RST}"
    echo ""
    echo "${BLD}The Python path is already copied to your clipboard.${RST}"
    echo ""
    echo "In the window that opens:"
    echo "  1. Click the ${BLD}+${RST} button"
    echo "  2. Press ${BLD}Cmd+Shift+G${RST} and paste (Cmd+V)"
    echo "  3. Press Enter, then click ${BLD}Open${RST}"
    echo "  4. Toggle the switch next to Python to ${GRN}ON${RST}"
    echo "  5. Enter your Mac password when asked"
    echo ""
    read -p "Press ENTER to open System Settings..."

    open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"

    # Poll until permission is granted
    echo ""
    echo -n "Waiting for permission to be granted"
    START=$(date +%s)
    while ! has_fda; do
        NOW=$(date +%s)
        ELAPSED=$((NOW - START))
        if [ $ELAPSED -gt 300 ]; then
            echo ""
            echo "${RED}Timed out after 5 minutes. Re-run this script when you're ready.${RST}"
            exit 1
        fi
        echo -n "."
        sleep 2
    done
    echo ""
    echo "${GRN}Full Disk Access granted!${RST}"
fi

# -------- 4. Restart scanner if installed --------
echo ""
PLIST="$HOME/Library/LaunchAgents/com.bilal.driveman.plist"
if [ -f "$PLIST" ]; then
    echo "Restarting scanner..."
    launchctl unload "$PLIST" 2>/dev/null || true
    sleep 1
    launchctl load "$PLIST"
    echo "${GRN}Scanner restarted.${RST}"

    LOG="$HOME/Library/Application Support/BilalDriveMan/scanner.log"
    if [ -f "$LOG" ]; then
        echo ""
        echo "Latest scanner activity:"
        tail -5 "$LOG" | sed 's/^/  /'
    fi
else
    echo "${YLW}No scanner LaunchAgent installed at:${RST}"
    echo "  $PLIST"
    echo "Set up the scanner first, then re-run this script."
fi

echo ""
echo "${BLD}${GRN}Done.${RST}"
echo ""
