@echo off
setlocal
cd /d "%~dp0"

set "PID_FILE=.uvicorn.pid"

if not exist "%PID_FILE%" (
  echo PID file not found. Server may already be stopped.
  exit /b 0
)

for /f %%i in (%PID_FILE%) do set "SERVER_PID=%%i"
taskkill /PID %SERVER_PID% /T /F >nul 2>&1

if errorlevel 1 (
  echo Failed to stop PID %SERVER_PID%. It may already be closed.
) else (
  echo Server stopped. PID: %SERVER_PID%
)

del "%PID_FILE%" >nul 2>&1
endlocal
