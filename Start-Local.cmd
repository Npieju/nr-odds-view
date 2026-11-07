@echo off
setlocal
cd /d "%~dp0"
set "ODDS_NODE=node.exe"
if exist "%~dp0runtime\node.exe" set "ODDS_NODE=%~dp0runtime\node.exe"
"%ODDS_NODE%" --dns-result-order=ipv4first "%~dp0src\local.mjs" %*
set "ODDS_EXIT=%errorlevel%"
if not "%ODDS_EXIT%"=="0" pause
exit /b %ODDS_EXIT%
