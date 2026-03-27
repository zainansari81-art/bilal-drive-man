#!/bin/bash
echo "============================================"
echo "  Bilal - Drive Man: Mac Scanner Installer"
echo "============================================"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is required. Install from https://python.org"
    exit 1
fi

echo "Installing dependencies..."
pip3 install rumps

echo ""
echo "Choose install mode:"
echo "  1) Menu bar app (shows BD icon in menu bar)"
echo "  2) Background service (auto-starts on login, no UI)"
echo "  3) Console mode (run manually in terminal)"
echo ""
read -p "Enter choice [1/2/3]: " choice

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

case $choice in
    1)
        echo "Starting menu bar app..."
        python3 "$SCRIPT_DIR/drive_scanner_mac.py" &
        echo "Running! Look for 'BD' in your menu bar."
        ;;
    2)
        echo "Installing as background service..."
        python3 "$SCRIPT_DIR/drive_scanner_mac.py" --install
        ;;
    3)
        echo "Starting console mode..."
        python3 "$SCRIPT_DIR/drive_scanner_mac.py" --console
        ;;
    *)
        echo "Invalid choice. Running in console mode..."
        python3 "$SCRIPT_DIR/drive_scanner_mac.py" --console
        ;;
esac
