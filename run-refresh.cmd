@echo off
cd /d "%~dp0"
node bin\chat-radar.js refresh >> data\refresh.log 2>&1
