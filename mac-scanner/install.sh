#!/bin/bash
# ─────────────────────────────────────────────────
#  BILAL - DRIVE MAN: Mac Scanner Installer
#  Copy this folder to any Mac and run:
#    bash install.sh
# ─────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCANNER="$SCRIPT_DIR/drive_scanner_mac.py"
PYTHON=$(which python3)
PLIST_NAME="com.bilal.driveman"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
LOG_DIR="$HOME/Library/Application Support/BilalDriveMan"

echo "=================================="
echo "  BILAL - DRIVE MAN: Installer"
echo "=================================="
echo ""

# Check Python
if [ -z "$PYTHON" ]; then
    echo "ERROR: python3 not found. Install Python first from https://python.org"
    exit 1
fi
echo "Using Python: $PYTHON"

# Install rumps
echo "Installing dependencies..."
pip3 install rumps 2>/dev/null || true

# Create log directory
mkdir -p "$LOG_DIR"

# Stop existing if running
launchctl unload "$PLIST_PATH" 2>/dev/null
pkill -f drive_scanner_mac.py 2>/dev/null
sleep 1

# Create LaunchAgent plist
cat > "$PLIST_PATH" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$PYTHON</string>
        <string>$SCANNER</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/stderr.log</string>
</dict>
</plist>
PLISTEOF

# Load and start
launchctl load "$PLIST_PATH"
sleep 2

# Verify
if pgrep -f drive_scanner_mac.py > /dev/null; then
    echo ""
    echo "Scanner is running!"
    echo "It will auto-start every time this Mac turns on."
    echo "If it crashes, it restarts automatically."
    echo ""
    echo "To check status:  ps aux | grep drive_scanner"
    echo "To stop:          launchctl unload $PLIST_PATH"
    echo "To view logs:     cat '$LOG_DIR/scanner.log'"
else
    echo ""
    echo "WARNING: Scanner may not have started."
    echo "Try running manually: $PYTHON $SCANNER"
fi
