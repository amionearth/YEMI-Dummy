@echo off
setlocal
chcp 65001 >nul
title Useless Pet - Field Fridge
cd /d "%~dp0"

set "PY_EXE=%~dp0.venv\Scripts\python.exe"
if not exist "%PY_EXE%" (
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
)
if not exist "%PY_EXE%" set "PY_EXE=python"

echo Launching Useless Pet Field Fridge Popup...
start "" "%PY_EXE%" scripts\fridge_popup.py
exit /b 0
