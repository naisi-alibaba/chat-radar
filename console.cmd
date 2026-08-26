@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install it from https://nodejs.org
  pause
  exit /b 1
)
echo Starting chat-radar console... a browser window will open.
echo Keep this window open; close it to stop the console (and its auto-refresh).
node "%~dp0installer\server.js"
pause
