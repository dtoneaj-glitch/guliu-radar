@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo.
echo  正在啟動凱基行情 PoC...
echo.
python "bridge\poc_runner.py"
echo.
pause
