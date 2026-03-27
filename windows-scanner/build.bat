@echo off
echo ============================================
echo   Building Bilal - Drive Man Scanner
echo ============================================

pip install -r requirements.txt

pyinstaller --noconfirm --onefile --windowed ^
    --name "BilalDriveMan-Scanner" ^
    --hidden-import pystray ^
    --hidden-import PIL ^
    --hidden-import pystray._win32 ^
    drive_scanner.py

echo.
echo ============================================
echo   Build complete!
echo   Executable: dist\BilalDriveMan-Scanner.exe
echo ============================================
pause
