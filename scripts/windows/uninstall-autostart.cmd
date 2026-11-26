@echo off
rem Stops troonooz from starting automatically. Does not stop a troonooz window that is already open.
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\troonooz.lnk"
if exist "%LINK%" (
  del "%LINK%"
  echo troonooz will no longer start automatically.
) else (
  echo troonooz was not set to start automatically.
)
