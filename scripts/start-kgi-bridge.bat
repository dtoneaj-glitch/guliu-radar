@echo off
setlocal
rem  Guliu Radar - KGI SUPER PY live bridge runner
rem  Starts bridge/kgi_bridge.py (reads .env from project root)
cd /d "%~dp0.."
if not exist "bridge\logs" mkdir "bridge\logs"
set LOG=bridge\logs\bridge.log
echo ---- >> "%LOG%"
echo [%date% %time%] bridge start >> "%LOG%"
python "bridge\kgi_bridge.py" >> "%LOG%" 2>&1
echo [%date% %time%] bridge exit=%errorlevel% >> "%LOG%"
endlocal
