@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PID_FILE=.uvicorn.pid"
set "STOPPED_PID="

:: ── Try PID file first ───────────────────────────────────────────────────────
if exist "%PID_FILE%" (
  set /p SERVER_PID=<"%PID_FILE%"
  if defined SERVER_PID (
    taskkill /PID !SERVER_PID! /T /F >nul 2>&1
    if not errorlevel 1 set "STOPPED_PID=!SERVER_PID!"
  )
)

:: ── Fallback: scan processes ─────────────────────────────────────────────────
if not defined STOPPED_PID (
  for /f %%i in ('powershell -NoProfile -Command "$py=(Resolve-Path '.\.venv\Scripts\python.exe').Path; foreach ($p in Get-CimInstance Win32_Process) { if ($p.ExecutablePath -eq $py -and $p.CommandLine -like '*uvicorn app:app*') { $p.ProcessId } }"') do (
    taskkill /PID %%i /T /F >nul 2>&1
    if not errorlevel 1 set "STOPPED_PID=%%i"
  )
)

del "%PID_FILE%" >nul 2>&1

if defined STOPPED_PID (
  echo 서버 종료 완료. PID: !STOPPED_PID!
) else (
  echo 실행 중인 서버가 없습니다.
)

endlocal
