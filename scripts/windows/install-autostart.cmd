@echo off
rem Runs install-autostart.ps1 without changing your PowerShell script policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
