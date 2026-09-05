@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Useless Pet - Floating Desktop Pet

echo Starting always-floating OpenPets companion...
start "" ".venv\Scripts\python.exe" "scripts\desktop_pet.py"
