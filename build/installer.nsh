; Windows installer customization (electron-builder `nsis.include`, see ADR-023).
; - Replaces the finish page to add a "desktop shortcut" checkbox next to "run Browser".
; - Registers Browser as a web browser (ADR-039) so that it is listed in Windows "Default apps":
;   a StartMenuInternet client, Capabilities (URL and file associations, pointing to our ProgIds)
;   and a RegisteredApplications entry. Windows 10/11 then lets the user pick it in Settings
;   (`ms-settings:defaultapps?registeredAppUser=Browser`); an app can never make itself default.
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

; ---- Default browser registration (ADR-039) ----------------------------------------------------
; Per-user installs write under HKCU, per-machine ones under HKLM (SHELL_CONTEXT follows the mode).
!define BROWSER_CLIENT "Software\Clients\StartMenuInternet\Browser"
!define BROWSER_CAPS "${BROWSER_CLIENT}\Capabilities"

!macro registerBrowserProgId PROGID DESCRIPTION
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "" "${DESCRIPTION}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "FriendlyTypeName" "${DESCRIPTION}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\Application" "ApplicationName" "Browser"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\Application" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open\command" "" '"$appExe" "%1"'
!macroend

!macro customInstall
  !insertmacro registerBrowserProgId "BrowserURL" "Lien web"
  WriteRegStr SHELL_CONTEXT "Software\Classes\BrowserURL" "URL Protocol" ""
  !insertmacro registerBrowserProgId "BrowserHTML" "Page HTML"
  !insertmacro registerBrowserProgId "BrowserPDF" "Document PDF"

  WriteRegStr SHELL_CONTEXT "${BROWSER_CLIENT}" "" "Browser"
  WriteRegStr SHELL_CONTEXT "${BROWSER_CLIENT}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${BROWSER_CLIENT}\shell\open\command" "" '"$appExe"'
  WriteRegStr SHELL_CONTEXT "${BROWSER_CAPS}" "ApplicationName" "Browser"
  WriteRegStr SHELL_CONTEXT "${BROWSER_CAPS}" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${BROWSER_CAPS}" "ApplicationDescription" "Un navigateur rapide, privé et entièrement personnalisable."
  WriteRegStr SHELL_CONTEXT "${BROWSER_CAPS}\StartMenu" "StartMenuInternet" "Browser"
  WriteRegStr SHELL_CONTEXT "${BROWSER_CAPS}\URLAssociations" "http" "BrowserURL"
  WriteRegStr SHELL_CONTEXT "${BROWSER_CAPS}\URLAssociations" "https" "BrowserURL"
  WriteRegStr SHELL_CONTEXT "${BROWSER_CAPS}\FileAssociations" ".html" "BrowserHTML"
  WriteRegStr SHELL_CONTEXT "${BROWSER_CAPS}\FileAssociations" ".htm" "BrowserHTML"
  WriteRegStr SHELL_CONTEXT "${BROWSER_CAPS}\FileAssociations" ".xhtml" "BrowserHTML"
  WriteRegStr SHELL_CONTEXT "${BROWSER_CAPS}\FileAssociations" ".pdf" "BrowserPDF"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Browser" "${BROWSER_CAPS}"
  ; Tells Explorer the associations changed.
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ; An update reinstalls over the same keys: only a real uninstall removes them.
  ${ifNot} ${isUpdated}
    DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Browser"
    DeleteRegKey SHELL_CONTEXT "${BROWSER_CLIENT}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\BrowserURL"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\BrowserHTML"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\BrowserPDF"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endIf}
!macroend
