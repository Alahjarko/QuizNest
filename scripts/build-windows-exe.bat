@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0.."

echo.
echo [QuizNest] Windows EXE build
echo Project: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Please install Node.js 20 or newer.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Please install Node.js 20 or newer.
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cargo was not found. Please install Rust from https://rustup.rs/.
  exit /b 1
)

echo [1/5] Installing npm dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  exit /b 1
)

echo.
echo [2/5] Syncing frontend files to dist...
call npm run sync-dist
if errorlevel 1 (
  echo [ERROR] npm run sync-dist failed.
  exit /b 1
)

echo.
echo [3/5] Checking Tauri CLI...
cargo tauri --version >nul 2>nul
if errorlevel 1 (
  echo Tauri CLI was not found. Installing tauri-cli 2.11.2...
  cargo install tauri-cli --version 2.11.2 --locked
  if errorlevel 1 (
    echo [ERROR] Failed to install tauri-cli.
    exit /b 1
  )
)

echo.
echo [4/5] Building NSIS installer EXE...
cd /d "%CD%\src-tauri"
cargo tauri build --bundles nsis --ci
if errorlevel 1 (
  echo.
  echo [WARN] NSIS build failed. Trying default Windows bundles...
  cargo tauri build --ci
  if errorlevel 1 (
    echo [ERROR] Tauri Windows build failed.
    exit /b 1
  )
)
cd /d "%~dp0.."

echo.
echo [5/5] Locating installer...
set "EXE_PATH="
for /f "delims=" %%F in ('dir /b /s "src-tauri\target\release\bundle\nsis\*.exe" 2^>nul') do (
  set "EXE_PATH=%%F"
)

if not defined EXE_PATH (
  echo [ERROR] Build completed, but no NSIS .exe installer was found.
  echo Look under: src-tauri\target\release\bundle
  exit /b 1
)

copy /Y "%EXE_PATH%" "QuizNest_windows_setup.exe" >nul
if errorlevel 1 (
  echo [ERROR] Failed to copy installer to project root.
  exit /b 1
)

echo.
echo [OK] Windows installer created:
echo %CD%\QuizNest_windows_setup.exe
echo.
endlocal
