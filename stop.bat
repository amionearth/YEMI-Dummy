@echo off
REM Stop any running Useless Pet dashboard server.
setlocal
chcp 65001 >nul
title Useless Pet - stop

echo.
echo  Stopping Useless Pet dashboard...
echo.

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":7860" ^| findstr "LISTENING"') do (
    echo  Killing PID %%P on port 7860 ...
    taskkill /F /PID %%P >nul 2>&1
)

echo  Done.
timeout /t 2 >nul
endlocal
