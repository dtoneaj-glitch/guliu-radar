@echo off
setlocal
rem ============================================================
rem  Guliu Radar - data backup
rem  Copies runtime data files into backups\YYYYMMDD\
rem ============================================================
cd /d "%~dp0.."
set STAMP=%date:~0,4%%date:~5,2%%date:~8,2%
set DEST=backups\%STAMP%
if not exist "%DEST%" mkdir "%DEST%"
echo [%date% %time%] backup -> %DEST%
for %%F in (server\data\radar.db server\data\users.json server\data\notifications.json server\data\user-strategies.json server\data\audit-log.jsonl) do (
  if exist "%%F" (
    copy /y "%%F" "%DEST%\" >nul
    echo   copied %%F
  )
)
echo [%date% %time%] backup done
endlocal
