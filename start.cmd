@echo off
rem Start Composer GUI. Arguments are passed to scripts\start.ps1, e.g. -Port 5180 -NoBrowser -Check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
exit /b %ERRORLEVEL%
