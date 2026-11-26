@echo off
rem Starts troonooz. Used by the Startup-folder shortcut that install-autostart.cmd creates.
title troonooz
cd /d "%~dp0..\.."
echo Starting troonooz from %CD%
echo Keep this window open (minimized is fine). Close it to stop troonooz.
echo.
rem Get the latest version from GitHub first (skipped for a folder that came from a zip).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" -Unattended
echo.
call npm.cmd run dev
echo.
echo troonooz has stopped.
pause
