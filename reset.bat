@echo off
REM Wipe all pet state, dataset, and adapters for a clean slate.
setlocal
chcp 65001 >nul
title Useless Pet - reset

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

echo.
echo  ============================================================
echo   This will DELETE all feeding data and trained adapters.
echo  ============================================================
echo.
set /p CONFIRM="Type YES to confirm: "
if /i not "%CONFIRM%"=="YES" goto :cancelled

echo.
echo  Wiping pet state ...
for %%P in ("pet_brain\data" "pet_brain\checkpoints" "pet_brain\adapters" "pet_brain\eval" "pet_brain\_train_tmp") do (
    if exist %%P rd /s /q %%P
)

echo  [OK] Pet has been reset to unhatched state.
echo  Next start.bat will re-create the directories.
pause
exit /b 0

:cancelled
echo  Cancelled.
pause
exit /b 0
