@echo off
rem Jackpot HQ launcher — refreshes live jackpots/results in the background, then opens the app.
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LOCALAPPDATA%\JackpotHQ\updater.ps1"
start "" "%~dp0index.html"
