@echo off
setlocal
rem ============================================================
rem  Guliu Radar - register / manage daily archive tasks
rem    MAIN task : weekdays 15:00  (L≈6‰å) 
rem    LATE task : weekdays 21:00  (’∫/Lº/c6Zl)
rem  Usage:
rem    register-daily-task.bat          (create both)
rem    register-daily-task.bat run      (run main now)
rem    register-daily-task.bat delete   (remove both)
rem ============================================================
set TASK=GuliuRadar-DailyArchive
set LATE=GuliuRadar-DailyArchive-Late
set BAT=%~dp0run-daily-archive.bat
if /I "%~1"=="delete" goto :del
if /I "%~1"=="run" goto :run
schtasks /Create /TN "%TASK%" /TR "%BAT%" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 15:00 /F
schtasks /Create /TN "%LATE%" /TR "%BAT%" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 21:00 /F
echo.
echo Created "%TASK%" (weekdays 15:00) and "%LATE%" (weekdays 21:00).
echo Run now : register-daily-task.bat run
echo Remove  : register-daily-task.bat delete
goto :eof
:run
schtasks /Run /TN "%TASK%"
goto :eof
:del
schtasks /Delete /TN "%TASK%" /F
schtasks /Delete /TN "%LATE%" /F
goto :eof
