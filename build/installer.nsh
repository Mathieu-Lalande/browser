; Windows installer customization (electron-builder `nsis.include`, see ADR-023).
; Replaces the finish page to add a "desktop shortcut" checkbox next to "run Browser".
; electron-builder creates the desktop shortcut during installation (and the uninstaller removes it);
; unchecking the box deletes it when the user leaves the finish page.
; Silent installs and updates never show this page: the shortcut is kept.
; This file is UTF-8 with a BOM so that makensis reads the accented strings correctly.

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  ; Required by MUI_FINISHPAGE_SHOWREADME; the checkbox state is read on leave instead.
  Function DesktopShortcutNoop
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Créer un raccourci sur le Bureau"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "DesktopShortcutNoop"
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE "FinishPageLeave"
  !insertmacro MUI_PAGE_FINISH

  ; Defined after the page: $mui.FinishPage.ShowReadme is declared by MUI_PAGE_FINISH.
  Function FinishPageLeave
    ${NSD_GetState} $mui.FinishPage.ShowReadme $0
    ${if} $0 != ${BST_CHECKED}
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${endif}
  FunctionEnd
!macroend
