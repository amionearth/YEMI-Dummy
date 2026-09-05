@echo off
REM Launch the connected Useless Pet experience:
REM 1. Brain & Web Dashboard (http://127.0.0.1:7860)
REM 2. Golden Pixel Fridge desktop overlay with hand tracking (food_inbox, max 9 specimens)

chcp 65001 >nul
title Useless Pet - Launcher

cd /d "%~dp0"

echo.
echo  ============================================================
echo   USELESS PET  -  Starting System
echo  ============================================================
echo.
echo  1. Starting Pet Brain & Web Dashboard at http://127.0.0.1:7860
echo  2. Starting Always-Floating Desktop Pet (Fridge opens when clicked)
echo.

start "Useless Pet - Brain & Dashboard" cmd /c "cd /d ""%~dp0"" && call start.bat"
timeout /t 2 >nul
start "Useless Pet - Floating Pet"      cmd /c "cd /d ""%~dp0"" && call start_pet.bat"

echo  Done! Both programs are running.
timeout /t 3 >nul

