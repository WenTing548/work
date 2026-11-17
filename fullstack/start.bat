@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Shiguangji Fullstack Demo

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Install Node.js 18+ and try again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/2] Installing Node.js dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed. Check your network and Node.js installation.
    pause
    exit /b 1
  )
)

echo [2/2] Starting Shiguangji full-stack demo...
echo URL: http://127.0.0.1:3000
echo MySQL 8.0 must be running before you start this demo.
echo Close this window to stop the server.
echo.

node server.js --open
if errorlevel 1 (
  echo.
  echo [ERROR] Server exited.
  echo Check that MySQL80 is running, and that port 3000 is not used by another program.
)
pause
