@echo off
chcp 65001 >nul
setlocal
rem ============================================================
rem  Guliu Radar - Cloudflare Quick Tunnel (for tester access)
rem  Exposes http://localhost:3000 (frontend; /api is proxied to 3001)
rem  Keep this window OPEN while testers are using it.
rem  Copy the https://xxxx.trycloudflare.com URL printed below.
rem ============================================================
echo.
echo   Starting Cloudflare Quick Tunnel to http://localhost:3000 ...
echo   (keep this window open; copy the https URL below for your testers)
echo.
where cloudflared >nul 2>&1
if errorlevel 1 (
  echo   [X] cloudflared not found. Install it first:
  echo       winget install --id Cloudflare.cloudflared
  echo.
  pause
  exit /b 1
)
cloudflared tunnel --url http://localhost:3000
echo.
pause