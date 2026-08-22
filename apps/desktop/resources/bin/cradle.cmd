@echo off
setlocal
set "APP_EXE=%~dp0..\..\..\Cradle.exe"
set "CLI_ENTRY=%~dp0..\cli\index.cjs"

if not exist "%APP_EXE%" (
  echo Cannot find Cradle app executable at "%APP_EXE%" >&2
  exit /b 1
)

if not exist "%CLI_ENTRY%" (
  echo Cannot find Cradle CLI entry at "%CLI_ENTRY%" >&2
  exit /b 1
)

set "ELECTRON_RUN_AS_NODE=1"
"%APP_EXE%" "%CLI_ENTRY%" %*
