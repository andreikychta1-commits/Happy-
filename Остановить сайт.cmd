@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-site.ps1" -Stop
if errorlevel 1 (
    echo.
    echo Could not stop the website server. Send this message to Codex.
    pause
)
endlocal
