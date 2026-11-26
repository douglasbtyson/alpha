@echo off
rem Turns this troonooz folder into a Git copy so it can update itself. Run once.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0switch-to-git.ps1"
