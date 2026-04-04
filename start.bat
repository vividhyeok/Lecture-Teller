@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PID_FILE=.uvicorn.pid"
set "APP_URL=http://127.0.0.1:8000/"
set "PYTHON_EXE=%CD%\.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
  echo [.venv] not found.
  echo Create it first:
  echo   py -m venv .venv
  echo   .venv\Scripts\activate
  echo   pip install -r requirements.txt
  exit /b 1
)

set "RUNNING_PID="
for /f %%i in ('powershell -NoProfile -Command "$py=(Resolve-Path '.\.venv\Scripts\python.exe').Path; foreach ($proc in Get-CimInstance Win32_Process) { if ($proc.ExecutablePath -eq $py -and $proc.CommandLine -like '*uvicorn app:app --host 127.0.0.1 --port 8000*') { $proc.ProcessId; break } }"') do set "RUNNING_PID=%%i"

if defined RUNNING_PID (
  >"%PID_FILE%" echo !RUNNING_PID!
  start "" "%APP_URL%"
  echo Server already running. PID: !RUNNING_PID!
  exit /b 0
)

for /f %%i in ('powershell -NoProfile -Command "$p=Start-Process -FilePath '.\.venv\Scripts\python.exe' -ArgumentList '-m','uvicorn','app:app','--host','127.0.0.1','--port','8000' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru; $p.Id"') do set "SERVER_PID=%%i"

if not defined SERVER_PID (
  echo Failed to start server.
  exit /b 1
)

>"%PID_FILE%" echo !SERVER_PID!
echo Starting server on %APP_URL%

powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(15); while((Get-Date) -lt $deadline) { try { Invoke-WebRequest -UseBasicParsing '%APP_URL%health' | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if errorlevel 1 (
  echo Server process started, but health check timed out.
  exit /b 1
)

start "" "%APP_URL%"
echo Server started. PID: !SERVER_PID!
endlocal
