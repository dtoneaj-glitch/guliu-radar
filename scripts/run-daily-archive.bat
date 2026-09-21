@echo off
setlocal
rem ============================================================
rem  Guliu Radar - daily archive runner
rem  Runs the standalone archive job:
rem    - B0 snapshot  (quotes + institutional breakdown)
rem    - chipcard OI  (TAIFEX futures net OI)
rem  Idempotent: safe to run multiple times per day.
rem ============================================================
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"
set LOG=logs\daily-archive.log
echo ---- >> "%LOG%"
echo [%date% %time%] run start >> "%LOG%"
call "node_modules\.bin\tsx.cmd" "scripts\daily-archive.ts" >> "%LOG%" 2>&1
echo [%date% %time%] run exit=%errorlevel% >> "%LOG%"
endlocal

/* rewritten */