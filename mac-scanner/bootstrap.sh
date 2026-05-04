#!/bin/bash
# ─────────────────────────────────────────────────
#  BILAL - DRIVE MAN: Mac Scanner Bootstrap
#
#  Privacy-friendly one-liner installer that downloads ONLY the 3 mac-scanner
#  files (no web-app source, docs, Windows scanner, or other repo content).
#
#  Usage:
#    curl -fsSL https://raw.githubusercontent.com/zainansari81-art/bilal-drive-man/main/mac-scanner/bootstrap.sh | bash
# ─────────────────────────────────────────────────

set -e

REPO_RAW="https://raw.githubusercontent.com/zainansari81-art/bilal-drive-man/main/mac-scanner"
DEST="$HOME/bilal-drive-man/mac-scanner"

echo "=================================="
echo "  BILAL - DRIVE MAN: Bootstrap"
echo "=================================="
echo ""
echo "Installing to: $DEST"
echo ""

mkdir -p "$DEST"
cd "$DEST"

echo "Downloading scanner files..."
curl -fsSL -o drive_scanner_mac.py "$REPO_RAW/drive_scanner_mac.py"
curl -fsSL -o install.sh          "$REPO_RAW/install.sh"
curl -fsSL -o setup_mac.sh        "$REPO_RAW/setup_mac.sh"
chmod +x install.sh setup_mac.sh
echo "  Downloaded 3 files."
echo ""

echo "Running installer..."
bash install.sh
