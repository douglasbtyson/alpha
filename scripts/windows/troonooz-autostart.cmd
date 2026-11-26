@echo off
rem Starts troonooz. Used by the Startup-folder shortcut that install-autostart.cmd creates.
title troonooz
cd /d "%~dp0..\.."
echo Starting troonooz from %CD%
echo Keep this window open (minimized is fine). Close it to stop troonooz.
echo.
call npm.cmd run dev
echo.
echo troonooz has stopped.
pause
