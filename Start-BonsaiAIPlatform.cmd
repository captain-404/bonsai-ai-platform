@echo off
setlocal
set "PLATFORM_ROOT=%~dp0"
set "NODE_RUNTIME=C:\Users\Paran\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_RUNTIME%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found. Install Node.js 20+ or set the NODE_RUNTIME path in this launcher.
    pause
    exit /b 1
  )
  set "NODE_RUNTIME=node"
)

start "Bonsai AI Platform" /min "%NODE_RUNTIME%" "%PLATFORM_ROOT%server.js"
start "" "http://127.0.0.1:4176"
