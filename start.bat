@echo off
setlocal
cd /d "%~dp0"

set "PID_FILE=.uvicorn.pid"

if exist "%PID_FILE%" (
  for /f %%i in (%PID_FILE%) do set "EXISTING_PID=%%i"
  tasklist /FI "PID eq %EXISTING_PID%" | find "%EXISTING_PID%" >nul
  if not errorlevel 1 (
    start "" http://127.0.0.1:8000
    echo Server already running. PID: %EXISTING_PID%
    exit /b 0
  )
  del "%PID_FILE%" >nul 2>&1
)

if not exist ".venv\Scripts\activate.bat" (
  echo [.venv] not found.
  echo Create it first:
  echo   py -m venv .venv
  echo   .venv\Scripts\activate
  echo   pip install -r requirements.txt
  exit /b 1
)

for /f %%i in ('powershell -NoProfile -Command "$p = Start-Process cmd.exe -ArgumentList '/c','run_server.bat' -WorkingDirectory '%CD%' -WindowStyle Hidden -PassThru; $p.Id"') do set "SERVER_PID=%%i"
echo %SERVER_PID%>"%PID_FILE%"

echo Starting server on http://127.0.0.1:8000
powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8000'"

endlocal
