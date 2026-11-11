@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-site.ps1"
if errorlevel 1 (
    echo.
    echo Could not open the website. Send this message to Codex.
    pause
)
endlocal
