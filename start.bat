@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PID_FILE=.uvicorn.pid"
set "APP_URL=http://127.0.0.1:8000/v2/"
set "HEALTH_URL=http://127.0.0.1:8000/health"
set "PYTHON_EXE=%CD%\.venv\Scripts\python.exe"

:: ── Check .venv ─────────────────────────────────────────────────────────────
if not exist "%PYTHON_EXE%" (
  echo [오류] .venv 가 없습니다. 아래 순서로 설치하세요:
  echo.
  echo   py -m venv .venv
  echo   .venv\Scripts\activate
  echo   pip install -r requirements.txt
  echo.
  exit /b 1
)

:: ── Already running? ────────────────────────────────────────────────────────
set "RUNNING_PID="
for /f %%i in ('powershell -NoProfile -Command "$py=(Resolve-Path '.\.venv\Scripts\python.exe').Path; foreach ($p in Get-CimInstance Win32_Process) { if ($p.ExecutablePath -eq $py -and $p.CommandLine -like '*uvicorn app:app*') { $p.ProcessId; break } }"') do set "RUNNING_PID=%%i"

if defined RUNNING_PID (
  >"%PID_FILE%" echo !RUNNING_PID!
  echo 이미 실행 중입니다. (PID !RUNNING_PID!)
  start "" "%APP_URL%"
  exit /b 0
)

:: ── Start server ─────────────────────────────────────────────────────────────
echo LectureTeller 서버를 시작합니다...
for /f %%i in ('powershell -NoProfile -Command "$p=Start-Process -FilePath '.\.venv\Scripts\python.exe' -ArgumentList '-m','uvicorn','app:app','--host','127.0.0.1','--port','8000' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru; $p.Id"') do set "SERVER_PID=%%i"

if not defined SERVER_PID (
  echo [오류] 서버 프로세스를 시작할 수 없습니다.
  exit /b 1
)

>"%PID_FILE%" echo !SERVER_PID!

:: ── Wait for health check (max 20s) ─────────────────────────────────────────
powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(20); while((Get-Date) -lt $d) { try { Invoke-WebRequest -UseBasicParsing '%HEALTH_URL%' | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 400 } }; exit 1"
if errorlevel 1 (
  echo [경고] 서버가 응답하지 않습니다. 브라우저를 수동으로 열어보세요.
  exit /b 1
)

start "" "%APP_URL%"
echo 서버 시작 완료. PID: !SERVER_PID!
echo 브라우저: %APP_URL%
endlocal
