@echo off
echo Setting up Bilal - Drive Man Scanner to start with Windows...

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set EXE_PATH=%~dp0dist\BilalDriveMan-Scanner.exe

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%STARTUP%\BilalDriveMan-Scanner.lnk'); $sc.TargetPath = '%EXE_PATH%'; $sc.WorkingDirectory = '%~dp0dist'; $sc.Description = 'Bilal - Drive Man Scanner'; $sc.Save()"

echo Done! Scanner will now start automatically with Windows.
pause
