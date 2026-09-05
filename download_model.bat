@echo off
REM Now a thin wrapper around the Ollama model pull. The brain talks
REM to Ollama's local HTTP API, so we just need the model pulled there.
setlocal
chcp 65001 >nul
title Useless Pet - download model

set "PROJECT_DIR=%~dp0"

cd /d "%PROJECT_DIR%"

where ollama >nul 2>&1
if errorlevel 1 goto :no_ollama

echo.
echo  ============================================================
echo   Pulling smallthinker:latest into Ollama, about 3.6 GB
echo  ============================================================
echo.

ollama pull smallthinker:latest
if errorlevel 1 (
    echo.
    echo  [X] Pull failed. Check your internet connection.
)
pause
endlocal
exit /b 0

:no_ollama
echo  [X] Ollama is not on PATH. Install it from https://ollama.com/download
echo      and re-run this script.
pause
exit /b 1

