@echo off
setlocal
rem ============================================================
rem  Guliu Radar - daily archive runner
rem    1) B0 snapshot + chipcard OI + retail positions
rem    2) retry once on failure
rem    3) data backup
rem  Exit code: 0 = ok, non-zero = the archive step failed
rem ============================================================
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"
set LOG=logs\daily-archive.log
set ARC_ERR=0

echo ---- >> "%LOG%"
echo [%date% %time%] run start >> "%LOG%"

call "node_modules\.bin\tsx.cmd" "scripts\daily-archive.ts" >> "%LOG%" 2>&1
set ARC_ERR=%errorlevel%

if not "%ARC_ERR%"=="0" (
  echo [%date% %time%] first attempt failed rc=%ARC_ERR%, retry in 60s >> "%LOG%"
  timeout /t 60 /nobreak >nul
  call "node_modules\.bin\tsx.cmd" "scripts\daily-archive.ts" >> "%LOG%" 2>&1
  set ARC_ERR=%errorlevel%
)

echo [%date% %time%] archive exit=%ARC_ERR% >> "%LOG%"

call "scripts\backup-data.bat" >> "%LOG%" 2>&1

echo [%date% %time%] run done (archive rc=%ARC_ERR%) >> "%LOG%"
endlocal & exit /b %ARC_ERR%
