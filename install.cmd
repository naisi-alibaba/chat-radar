@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install it from https://nodejs.org then run this again.
  pause
  exit /b 1
)
echo Starting chat-radar installer...
echo A browser window will open automatically. Keep this window open; close it to stop.
node "%~dp0installer\server.js"
pause
