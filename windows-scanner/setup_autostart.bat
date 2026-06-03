@echo off
echo Setting up Bilal - Drive Man Scanner to start with Windows...

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

REM Auto-detect the install layout. The GitHub Actions build ships the .exe
REM under dist\, but manually-deployed installs (e.g. PC2) keep the .exe in
REM the SAME folder as this script. Pick whichever actually exists so we never
REM write a Startup shortcut to a non-existent path -- a dead autostart entry
REM is exactly what let PC2 silently stop relaunching (caught 2026-06-03).
if exist "%~dp0dist\BilalDriveMan-Scanner.exe" (
    set "EXE_PATH=%~dp0dist\BilalDriveMan-Scanner.exe"
    set "WORK_DIR=%~dp0dist"
) else if exist "%~dp0BilalDriveMan-Scanner.exe" (
    set "EXE_PATH=%~dp0BilalDriveMan-Scanner.exe"
    set "WORK_DIR=%~dp0."
) else (
    echo ERROR: BilalDriveMan-Scanner.exe not found here or in a dist\ subfolder.
    echo Put this script next to the .exe ^(or its dist\ folder^) and re-run.
    pause
    exit /b 1
)

echo Target: %EXE_PATH%

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%STARTUP%\BilalDriveMan-Scanner.lnk'); $sc.TargetPath = '%EXE_PATH%'; $sc.WorkingDirectory = '%WORK_DIR%'; $sc.Description = 'Bilal - Drive Man Scanner'; $sc.Save()"

echo Done! Scanner will now start automatically with Windows.
pause
