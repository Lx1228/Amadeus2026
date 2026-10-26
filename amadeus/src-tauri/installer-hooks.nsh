; Amadeus NSIS installer hooks (Tauri v2 installerHooks)
; ========================================================
; 2026-10-20: fans hit "Error opening file for writing:
;   ...\standalone\node.exe" when upgrading - the OLD Amadeus was
;   still running and its sidecar node.exe locked the file.
; Tauri's built-in check only covers the main exe, not the sidecar.
; So: kill main app + sidecar before install/uninstall.
; Keep this file ASCII-only (same rules as setup-voice.bat).

!macro _AmadeusKillRunning
  ; main executable (built binary name is app.exe; Amadeus.exe just in case)
  nsExec::Exec 'taskkill /IM app.exe /F'
  nsExec::Exec 'taskkill /IM Amadeus.exe /F'
  ; sidecar node.exe - kill ONLY the one inside the Amadeus folder,
  ; never touch a user's own node processes (Path match is path-based)
  nsExec::Exec `powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where Path -match 'Amadeus' | Stop-Process -Force"`
  ; give the OS a moment to release file locks
  Sleep 800
!macroend

!macro _AmadeusTryDefenderExclude
  ; Best-effort: add install dir to Defender exclusions so real-time
  ; scanning does not lock node.exe while NSIS writes it (and later so
  ; the voice-install .bat is not blocked). Needs admin; silently fails
  ; on per-user installs - third-party AV (360/Huawei Manager etc.)
  ; cannot be automated, user must whitelist manually.
  nsExec::Exec `powershell -NoProfile -Command "Add-MpPreference -ExclusionPath '$INSTDIR' -ErrorAction SilentlyContinue"`
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro _AmadeusKillRunning
  !insertmacro _AmadeusTryDefenderExclude
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro _AmadeusKillRunning
!macroend
