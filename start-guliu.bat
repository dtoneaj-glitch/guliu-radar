@echo off
rem  Guliu Radar - start dev servers and open browser
cd /d "%~dp0"
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  start "Guliu Radar" /min cmd /c "pnpm dev"
  timeout /t 6 /nobreak >nul
)
start "" "http://127.0.0.1:3000/"
