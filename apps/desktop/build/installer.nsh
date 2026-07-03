; Custom NSIS installer script for Cradle
; Overrides the default CHECK_APP_RUNNING behavior to handle the case where
; the Electron app takes time to shut down (async cleanup in before-quit).
;
; See: https://github.com/electron-userland/electron-builder/issues/6409
; See: https://github.com/electron-userland/electron-builder/issues/894

; --- Early init: kill process + pre-clean heavy directories ---

!macro customInit
  ; Kill any lingering process first
  nsProcess::_KillProcess "${APP_EXECUTABLE_FILENAME}" $R0
  Sleep 1000

  ; Pre-clean heavy directories so the uninstaller doesn't time out.
  ; resources/server/node_modules can be thousands of files — Windows
  ; deletes them very slowly via atomicRMDir, which causes timeout → retry loops.
  RMDir /r "$INSTDIR\resources\server\node_modules"
  RMDir /r "$INSTDIR\resources\server"
!macroend

; --- Override process detection during install ---
; Give the app more time to exit gracefully and use more retries before
; showing the "cannot be closed" dialog.

!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  SetDetailsPrint textonly

  ${GetProcessInfo} 0 $pid $1 $2 $3 $4

  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    ${if} ${isUpdated}
      DetailPrint `Waiting for "${PRODUCT_NAME}" to exit gracefully...`
      Sleep 3000
    ${endIf}

    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      DetailPrint `"${PRODUCT_NAME}" is still running, attempting to close...`

      nsExec::Exec `taskkill /IM "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid"`
      Sleep 2000

      StrCpy $R1 0
      StrCpy $R2 5

      loop:
        IntOp $R1 $R1 + 1

        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 == 0
          DetailPrint `Attempt $R1/$R2: force-killing "${PRODUCT_NAME}"...`
          nsExec::Exec `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid"`
          Sleep 2000

          ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
          ${if} $R0 == 0
            ${if} $R1 >= $R2
              DetailPrint `Unable to close "${PRODUCT_NAME}" automatically.`
              MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY loop
              Quit
            ${endIf}
            Goto loop
          ${else}
            Goto not_running
          ${endIf}
        ${else}
          Goto not_running
        ${endIf}

      not_running:
        DetailPrint `"${PRODUCT_NAME}" has been closed.`
    ${else}
      DetailPrint `"${PRODUCT_NAME}" is not running.`
    ${endIf}
  ${endIf}

  SetDetailsPrint none
!macroend
