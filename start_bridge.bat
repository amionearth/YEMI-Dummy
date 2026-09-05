@echo off
REM Start the ESP32 <-> brain bridge. Tries to auto-detect the COM port.
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Useless Pet - ESP32 bridge

set "PROJECT_DIR=%~dp0"
set "VENV_PY=%PROJECT_DIR%.venv\Scripts\python.exe"

cd /d "%PROJECT_DIR%"

if not exist "%VENV_PY%" goto :no_venv

echo.
echo  ============================================================
echo   USELESS PET  -  ESP32 bridge
echo  ============================================================
echo.

REM Try to find an ESP32-like COM port automatically. Fall back to prompting.
set "PORT="
for /f "tokens=*" %%P in ('"%VENV_PY%" -c "import serial.tools.list_ports as lp; cs=[p.device for p in lp.comports() if p.vid is not None and p.vid in 0x303A 0x10C4 0x1A86 0x0403 0x2341]; print(cs[0] if cs else '')" 2^>nul') do (
    if not "%%P"=="" set "PORT=%%P"
)

if defined PORT goto :have_port
echo  No ESP32 detected. Available ports:
"%VENV_PY%" -c "import serial.tools.list_ports as lp; [print('   ', p.device, '-', p.description) for p in lp.comports()]"
echo.
set /p PORT="  Enter COM port, e.g. COM5: "
if "!PORT!"=="" goto :no_port
goto :have_port

:have_port
echo  [ok] Using port !PORT!
"%VENV_PY%" scripts\esp32_bridge.py --port !PORT!
goto :done

:no_port
echo  No port given, exiting.
pause
endlocal
exit /b 1

:done
endlocal

:no_venv
echo  [X] Virtual environment not found. Run install.bat first.
pause
exit /b 1
