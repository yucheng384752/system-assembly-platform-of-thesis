@echo off
rem Start only the AoV canvas (no Recipe, Kit selection or output pages). Arguments are passed to scripts\start.ps1, e.g. -Port 5180 -NoBrowser
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" -Page aov-canvas.html -NoCaseStore %*
exit /b %ERRORLEVEL%
