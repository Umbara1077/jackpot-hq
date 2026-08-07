@echo off
rem Jackpot HQ launcher - refreshes live data, starts the local server (which saves your
rem tickets to a real file), then opens the app.
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LOCALAPPDATA%\JackpotHQ\updater.ps1"

rem Start the server only if port 8123 isn't already serving.
netstat -ano | findstr /r /c:"TCP.*:8123 .*LISTENING" >nul
if errorlevel 1 (
  start "Jackpot HQ server" /min cmd /c "cd /d "%~dp0" && node scripts\serve.mjs"
  rem give node a moment to bind the port before the browser asks for the page
  ping -n 3 127.0.0.1 >nul
)

start "" "http://localhost:8123/"
