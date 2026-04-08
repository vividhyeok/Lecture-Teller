@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ========================================
echo   LectureTeller full build
echo ========================================
echo.

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] Missing .venv. Run:
  echo   py -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
  exit /b 1
)

if not exist "lectureteller-react\node_modules" (
  echo [ERROR] Missing node_modules. Run:
  echo   cd lectureteller-react ^&^& npm install
  exit /b 1
)

for /f "tokens=2" %%t in ('rustc -Vv ^| findstr /C:"host:"') do set "RUST_TARGET=%%t"
if not defined RUST_TARGET (
  echo [ERROR] Could not detect Rust host target.
  exit /b 1
)

echo Rust target: %RUST_TARGET%

echo.
echo [1/4] Building React app...
pushd lectureteller-react
call npm run build
if errorlevel 1 (
  popd
  echo [ERROR] React build failed.
  exit /b 1
)
popd

echo.
echo [2/4] Building Python server executable...
call .venv\Scripts\pyinstaller.exe ^
  --onefile ^
  --name server ^
  --distpath . ^
  --workpath build-tmp\pyinstaller-work ^
  --specpath build-tmp ^
  --collect-all uvicorn ^
  --collect-all fastapi ^
  --collect-all starlette ^
  --collect-all pydantic ^
  --collect-all pydantic_core ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.protocols ^
  --hidden-import uvicorn.protocols.http ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.websockets ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.lifespan ^
  --hidden-import uvicorn.lifespan.on ^
  server_entry.py
if errorlevel 1 (
  echo [ERROR] PyInstaller build failed.
  exit /b 1
)

echo.
echo [3/4] Copying server sidecar...
if not exist "lectureteller-react\src-tauri\binaries" mkdir "lectureteller-react\src-tauri\binaries"
copy /Y "server.exe" "lectureteller-react\src-tauri\binaries\server-%RUST_TARGET%.exe" >nul
if errorlevel 1 (
  echo [ERROR] Failed to copy sidecar binary.
  exit /b 1
)

echo.
echo [4/4] Building Tauri bundles...
pushd lectureteller-react
call npm run tauri:build
if errorlevel 1 (
  popd
  echo [ERROR] Tauri build failed.
  exit /b 1
)
popd

echo.
echo Build complete.
echo Artifacts:
echo   lectureteller-react\src-tauri\target\release\bundle\
echo.

endlocal
