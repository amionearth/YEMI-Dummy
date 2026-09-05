@echo off
REM ============================================================================
REM  Useless Pet - explicit one-time setup
REM
REM  Run this ONCE if you don't want start.bat to handle install for you.
REM  Or run it to repair the install if something went wrong.
REM ============================================================================

setlocal EnableDelayedExpansion
chcp 65001 >nul
title Useless Pet - setup

set "PROJECT_DIR=%~dp0"
set "VENV=%PROJECT_DIR%.venv"
set "VENV_PY=%VENV%\Scripts\python.exe"
set "VENV_PIP=%VENV%\Scripts\pip.exe"

cd /d "%PROJECT_DIR%"

echo.
echo  ============================================================
echo   USELESS PET  -  first-time setup
echo  ============================================================
echo.

where python >nul 2>&1
if errorlevel 1 goto :no_python

if not exist "%VENV%\Scripts\python.exe" goto :create_venv
echo  [OK] venv already present.
goto :after_venv

:create_venv
echo  [..] Creating virtual environment ...
python -m venv "%VENV%"
if errorlevel 1 goto :venv_failed
echo  [OK] venv created.

:after_venv

echo  [..] Upgrading pip ...
"%VENV_PY%" -m pip install --upgrade pip >nul

echo  [..] Installing dependencies, this can take a few minutes ...
"%VENV_PIP%" install -r requirements.txt
if errorlevel 1 goto :install_failed
echo  [OK] Dependencies installed.

echo.
echo  Setup complete. Run start.bat to launch.
pause
endlocal
exit /b 0

:no_python
echo  [X] Python not found. Install from https://www.python.org/downloads/
pause
exit /b 1

:venv_failed
echo  [X] Failed to create venv.
pause
exit /b 1

:install_failed
echo  [X] Install failed. Check your internet connection.
pause
exit /b 1
