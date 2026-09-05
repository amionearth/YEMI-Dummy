@echo off
REM Start the webcam feeder (OpenCV + OCR/card matching -> /api/feed).
setlocal
chcp 65001 >nul
title Useless Pet - webcam feeder

set "PROJECT_DIR=%~dp0"
set "VENV_PY=%PROJECT_DIR%.venv\Scripts\python.exe"

cd /d "%PROJECT_DIR%"

if not exist "%VENV_PY%" goto :no_venv

echo.
echo  ============================================================
echo   USELESS PET  -  webcam feeder
echo  ============================================================
echo.
echo  Make sure the brain is running first, start.bat.
echo  This window stays open while the cam is active.
echo  Press q in the preview window, or Ctrl+C here, to quit.
echo.

"%VENV_PY%" scripts\webcam_feeder.py --mode both --show
endlocal
exit /b 0

:no_venv
echo  [X] Virtual environment not found. Run install.bat first.
pause
exit /b 1
