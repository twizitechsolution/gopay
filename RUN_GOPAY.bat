@echo off
title Gopay - Local Development Server
color 0b

echo =======================================================
echo          GOPAY MASTER PLATFORM - LOCAL RUNNER
echo =======================================================
echo.
echo [*] Checking Node.js environment...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in your PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

echo [*] Starting Gopay Unified Server (Port 5000)...
echo.
echo -------------------------------------------------------
echo  User Web App:       http://localhost:5000
echo  Admin Dashboard:    http://localhost:5000/admin
echo  Backend API:        http://localhost:5000/api
echo  Mobile APK:         http://localhost:5000/Gopay.apk
echo -------------------------------------------------------
echo  Admin Login:        gopayadmin / gopay@143#!
echo  Super Admin Mobile: 9999999999 / PIN: 1234
echo  Telegram:           https://t.me/Gopay
echo -------------------------------------------------------
echo.

start "" "http://localhost:5000"
start "" "http://localhost:5000/admin"

cd backend
node src/server.js
pause
