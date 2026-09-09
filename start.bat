@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PID_FILE=.uvicorn.pid"
set "APP_URL=http://127.0.0.1:8000/v2/"
set "HEALTH_URL=http://127.0.0.1:8000/health"
set "PYTHON_EXE=%CD%\.venv\Scripts\python.exe"
set "FRONTEND_DIR=%CD%\lectureteller-react"
set "FRONTEND_MARKER=%CD%\.frontend.sha256"

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

:: ── Build frontend only when source changed ──────────────────────────────────
set "NEED_FRONTEND_BUILD="
for /f %%i in ('powershell -NoProfile -Command "$files=@('lectureteller-react/src/AppStable2.tsx','lectureteller-react/src/AppStable.css','lectureteller-react/src/main.tsx'); $hash=($files ^| ForEach-Object { (Get-FileHash $_ -Algorithm SHA256).Hash }) -join ''; if (!(Test-Path '.frontend.sha256') -or ((Get-Content '.frontend.sha256' -Raw).Trim() -ne $hash) -or !(Test-Path 'static-v2/index.html')) { '1' }"') do set "NEED_FRONTEND_BUILD=%%i"

if defined NEED_FRONTEND_BUILD (
  where npm.cmd >nul 2>&1
  if errorlevel 1 (
    echo [오류] 프론트엔드가 변경되었지만 npm을 찾을 수 없습니다.
    echo Node.js를 설치한 뒤 start.bat을 다시 실행하세요.
    exit /b 1
  )

  echo LectureTeller UI를 최신 상태로 빌드합니다...
  pushd "%FRONTEND_DIR%"
  if not exist "node_modules" (
    echo 프론트엔드 의존성을 처음 한 번 설치합니다...
    call npm.cmd ci
    if errorlevel 1 (
      popd
      echo [오류] npm ci에 실패했습니다.
      exit /b 1
    )
  )
  call npm.cmd run build
  if errorlevel 1 (
    popd
    echo [오류] 프론트엔드 빌드에 실패했습니다.
    exit /b 1
  )
  popd

  powershell -NoProfile -Command "$files=@('lectureteller-react/src/AppStable2.tsx','lectureteller-react/src/AppStable.css','lectureteller-react/src/main.tsx'); $hash=($files | ForEach-Object { (Get-FileHash $_ -Algorithm SHA256).Hash }) -join ''; Set-Content '.frontend.sha256' $hash -NoNewline"
)

:: ── Already running? ─────────────────────────────────────────────────────────
set "RUNNING_PID="
for /f %%i in ('powershell -NoProfile -Command "$py=(Resolve-Path '.\.venv\Scripts\python.exe').Path; foreach ($p in Get-CimInstance Win32_Process) { if ($p.ExecutablePath -eq $py -and ($p.CommandLine -like '*uvicorn server_entry:app*' -or $p.CommandLine -like '*uvicorn app:app*')) { $p.ProcessId; break } }"') do set "RUNNING_PID=%%i"

if defined RUNNING_PID (
  >"%PID_FILE%" echo !RUNNING_PID!
  echo 이미 실행 중입니다. (PID !RUNNING_PID!)
  start "" "%APP_URL%"
  exit /b 0
)

:: ── Start server ─────────────────────────────────────────────────────────────
echo LectureTeller 서버를 시작합니다...
for /f %%i in ('powershell -NoProfile -Command "$p=Start-Process -FilePath '.\.venv\Scripts\python.exe' -ArgumentList '-m','uvicorn','server_entry:app','--host','127.0.0.1','--port','8000' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru; $p.Id"') do set "SERVER_PID=%%i"

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
