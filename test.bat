@echo off
REM Quick health check. Verifies Python, venv, deps, brain imports,
REM API routes, and that the server can start and serve /api/state.
REM Does NOT keep the server running.

setlocal EnableDelayedExpansion
chcp 65001 >nul
title Useless Pet - health check

set "PROJECT_DIR=%~dp0"
set "VENV_PY=%PROJECT_DIR%.venv\Scripts\python.exe"

cd /d "%PROJECT_DIR%"

echo.
echo  ============================================================
echo   USELESS PET  -  health check
echo  ============================================================
echo.

set "OK=0"
set "FAIL=0"

where python >nul 2>&1
if errorlevel 1 goto :no_py
echo  [OK]  Python on PATH
goto :after_py

:no_py
echo  [X]   Python is not on PATH
set /a FAIL+=1

:after_py
if not exist "%VENV_PY%" goto :no_venv
echo  [OK]  venv exists at .venv
goto :after_venv

:no_venv
echo  [X]   venv missing, run install.bat
set /a FAIL+=1

:after_venv

echo.
echo  --- live boot test via smoke_html.py ---
"%VENV_PY%" scripts\smoke_html.py
if errorlevel 1 goto :boot_failed
echo  [OK]  Server boots, dashboard renders, all tabs present
set /a OK+=1
goto :after_boot

:boot_failed
echo  [X]   Live boot test failed, see output above
set /a FAIL+=1

:after_boot
echo.
echo  ============================================================
if %FAIL% gtr 0 (
    echo   %FAIL% check failed, %OK% passed.  See output above.
) else (
    echo   All %OK% checks passed.  Ready to run start.bat.
)
echo  ============================================================
echo.
if %FAIL% gtr 0 pause
endlocal
exit /b %FAIL%
