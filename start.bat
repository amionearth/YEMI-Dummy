@echo off
REM ============================================================================
REM  Useless Pet - one-click launcher
REM
REM  What this does:
REM    1. Verifies Python is installed.
REM    2. Creates a virtual environment on first run.
REM    3. Installs all dependencies.
REM    4. Pre-downloads the base LLM if missing.
REM    5. Starts the local dashboard.
REM    6. Opens it in your default browser.
REM
REM  Just double-click this file. No command line needed.
REM ============================================================================

setlocal EnableDelayedExpansion
chcp 65001 >nul
title Useless Pet

set "PROJECT_DIR=%~dp0"
set "VENV=%PROJECT_DIR%.venv"
set "VENV_PY=%VENV%\Scripts\python.exe"
set "VENV_PIP=%VENV%\Scripts\pip.exe"

cd /d "%PROJECT_DIR%"

echo.
echo  ============================================================
echo   USELESS PET  -  one-click launcher
echo  ============================================================
echo.

REM ---- 1. Check existing venv or find Python ----------------------------
if exist "%VENV%\Scripts\python.exe" (
    echo  [OK] venv already present.
    goto :after_venv
)

set "SYSTEM_PY="
where python >nul 2>&1 && set "SYSTEM_PY=python"
if not defined SYSTEM_PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set "SYSTEM_PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
)
if not defined SYSTEM_PY (
    where py >nul 2>&1 && set "SYSTEM_PY=py -3.12"
)

if not defined SYSTEM_PY goto :no_python

for /f "tokens=2" %%v in ('!SYSTEM_PY! --version 2^>^&1') do set PYVER=%%v
echo  [OK] Python !PYVER! found via !SYSTEM_PY!.

REM ---- 2. Create venv on first run ---------------------------------------
echo  [..] Creating virtual environment, one-time, about 10s ...
!SYSTEM_PY! -m venv "%VENV%"
if errorlevel 1 goto :venv_failed
echo  [OK] venv created.
goto :after_venv

:venv_failed
echo  [X] Failed to create venv.
pause
exit /b 1

:after_venv

REM ---- 3. Install requirements on first run -----------------------------
"%VENV_PY%" -c "import fastapi, uvicorn, PySide6" >nul 2>&1
if errorlevel 1 goto :install_deps
echo  [OK] Dependencies already installed.
goto :after_deps

:install_deps
echo  [..] Installing dependencies, one-time, about 2 to 5 min ...
"%VENV_PIP%" install --upgrade pip >nul
"%VENV_PIP%" install -r requirements.txt
if errorlevel 1 goto :deps_failed
echo  [OK] Dependencies installed.
goto :after_deps

:deps_failed
echo  [X] Dependency install failed. Check your internet connection.
pause
exit /b 1

:after_deps

REM ---- 4. Check that Ollama is up and a model is loaded ----------------
"%VENV_PY%" -c "import sys; sys.path.insert(0, '.'); from pet_brain.inference.engine import InferenceEngine; e=InferenceEngine(); s=e.status; sys.exit(0 if s.get('model_loaded') else 1)" >nul 2>&1
if not errorlevel 1 goto :ollama_ok
echo  [!] Ollama not ready or no model pulled.
echo      In a terminal, run:  ollama serve
echo      Then:                  ollama pull smallthinker:latest
echo      The dashboard still works for feeding/growing; chat is gated.
goto :after_model

:ollama_ok
echo  [OK] Ollama is running and smallthinker:latest is loaded.

:after_model

REM ---- 5. Start dashboard ------------------------------------------------
echo.
echo  ============================================================
echo   Starting dashboard at http://127.0.0.1:7860
echo   Press Ctrl+C in this window to stop the server.
echo  ============================================================
echo.

REM Open browser after a short delay (background).
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start http://127.0.0.1:7860"

"%VENV_PY%" -m dashboard.backend.server --host 127.0.0.1 --port 7860
set "EXITCODE=%errorlevel%"

echo.
if %EXITCODE% neq 0 (
    echo  [X] Server exited with code %EXITCODE%.
) else (
    echo  Server stopped cleanly.
)
echo  You can close this window.
pause
endlocal
exit /b %EXITCODE%

:no_python
echo  [X] Python is not installed.
echo.
echo      Download it from https://www.python.org/downloads/
echo      During install, TICK "Add python.exe to PATH".
echo.
pause
exit /b 1
