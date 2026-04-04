@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PID_FILE=.uvicorn.pid"
set "STOPPED_PID="

if exist "%PID_FILE%" (
  set /p SERVER_PID=<"%PID_FILE%"
  if defined SERVER_PID (
    taskkill /PID !SERVER_PID! /T /F >nul 2>&1
    if not errorlevel 1 (
      set "STOPPED_PID=!SERVER_PID!"
    )
  )
)

if not defined STOPPED_PID (
  for /f %%i in ('powershell -NoProfile -Command "$py=(Resolve-Path '.\.venv\Scripts\python.exe').Path; foreach ($proc in Get-CimInstance Win32_Process) { if ($proc.ExecutablePath -eq $py -and $proc.CommandLine -like '*uvicorn app:app --host 127.0.0.1 --port 8000*') { $proc.ProcessId } }"') do (
    taskkill /PID %%i /T /F >nul 2>&1
    if not errorlevel 1 set "STOPPED_PID=%%i"
  )
)

del "%PID_FILE%" >nul 2>&1

if defined STOPPED_PID (
  echo Server stopped. PID: !STOPPED_PID!
) else (
  echo Server is not running.
)

endlocal
