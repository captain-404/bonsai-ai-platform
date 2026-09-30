@echo off
setlocal
set "PLATFORM_ROOT=%~dp0"
rem Node: use NODE_RUNTIME if you set it, else node on PATH, else Pinokio's Node (edit the last line if yours differs).
if not defined NODE_RUNTIME (
  where node >nul 2>nul
  if not errorlevel 1 (set "NODE_RUNTIME=node") else if exist "C:\AI-Lab\Apps\bin\miniforge\node.exe" set "NODE_RUNTIME=C:\AI-Lab\Apps\bin\miniforge\node.exe"
)
if not defined NODE_RUNTIME (
  echo Node.js 20+ was not found. Install it or set NODE_RUNTIME to the full path of node.exe.
  pause
  exit /b 1
)
rem Tool paths and the port come from bonsai.config.json. If you change the port there, also change the URL below.
start "Bonsai AI Platform" /min "%NODE_RUNTIME%" "%PLATFORM_ROOT%server.js"
start "" "http://127.0.0.1:4176"
