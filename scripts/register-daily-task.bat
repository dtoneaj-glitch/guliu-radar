@echo off
setlocal
rem ============================================================
rem  Guliu Radar - register / manage the daily archive task
rem  Usage:
rem    register-daily-task.bat          (create task, weekdays 20:30)
rem    register-daily-task.bat run      (run the task now)
rem    register-daily-task.bat delete   (remove the task)
rem ============================================================
set TASK=GuliuRadar-DailyArchive
set BAT=%~dp0run-daily-archive.bat

if /I "%~1"=="delete" goto :del
if /I "%~1"=="run" goto :run

schtasks /Create /TN "%TASK%" /TR "%BAT%" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 20:30 /F
echo.
echo Created scheduled task "%TASK%" - runs Mon-Fri at 20:30.
echo Run now : register-daily-task.bat run
echo Remove  : register-daily-task.bat delete
goto :eof

:run
schtasks /Run /TN "%TASK%"
goto :eof

:del
schtasks /Delete /TN "%TASK%" /F
goto :eof
