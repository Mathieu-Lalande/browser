import { onLocaleChange, t } from "@shared/i18n";
import { Menu, app, type MenuItemConstructorOptions } from "electron";
import { commandMenuItems } from "./commands";
import { onSettingsChanged, settings } from "./settings";
import { onUpdateStatus, updateService } from "./updates";
import { BrowserController } from "./window";

/** Shortcuts the current menu was built with: the menu is rebuilt when the user changes them (ADR-028). */
let builtShortcuts: string | null = null;

onSettingsChanged((current) => {
  if (builtShortcuts !== null && JSON.stringify(current.shortcuts) !== builtShortcuts) installMenu();
});

// The menu is in the UI language (ADR-052): rebuilt when it changes.
onLocaleChange(() => {
  if (builtShortcuts !== null) installMenu();
});

/** Whether the menu shows "Redémarrer pour mettre à jour" (ADR-030): rebuilt when that changes. */
let builtUpdateReady = false;
const updateReady = () => updateService()?.status.phase === "ready";

onUpdateStatus(() => {
  if (builtShortcuts !== null && updateReady() !== builtUpdateReady) installMenu();
});

/** Run an action against the focused browser window, if any. */
function withFocused(action: (controller: BrowserController) => void): () => void {
  return () => {
    const controller = BrowserController.focused();
    if (controller) action(controller);
  };
}

/**
 * The application menu doubles as the keyboard shortcut registry: accelerators fire
 * whichever view (chrome UI, overlay or web page) has focus. Browser actions come from the
 * command registry (`src/shared/commands.ts`), shared with the command palette.
 */
export function installMenu(): void {
  const isMac = process.platform === "darwin";
  const tabNumbers: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    label: i === 8 ? t("menu.lastTab") : t("menu.tab", { p: i + 1 }),
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: withFocused((c) => c.tabs.activateIndex(i === 8 ? -1 : i)),
  }));

  const spaceNumbers: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    id: `space-${i + 1}`,
    label: i === 8 ? t("menu.lastSpace") : t("menu.space", { p: i + 1 }),
    accelerator: `CmdOrCtrl+Alt+${i + 1}`,
    click: withFocused((c) => c.spaces.switchIndex(i === 8 ? -1 : i)),
  }));

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: t("menu.file"),
      submenu: [
        ...commandMenuItems("new-tab"),
        ...commandMenuItems("new-window"),
        ...commandMenuItems("new-private-window"),
        ...commandMenuItems("duplicate-tab"),
        ...commandMenuItems("reopen-closed-tab"),
        ...commandMenuItems("reopen-closed-window"),
        { type: "separator" },
        ...commandMenuItems("save-page"),
        ...commandMenuItems("print"),
        { type: "separator" },
        ...commandMenuItems("open-history"),
        ...commandMenuItems("open-downloads"),
        ...commandMenuItems("import-data"),
        ...commandMenuItems("open-profiles"),
        ...commandMenuItems("open-task-manager"),
        ...commandMenuItems("open-settings"),
        ...commandMenuItems("check-updates"),
        ...(updateReady() ? commandMenuItems("install-update") : []),
        ...commandMenuItems("close-tab"),
        { type: "separator" },
        // macOS: Quitter is in the app menu (Cmd+Q); elsewhere the registry command (ADR-033).
        ...(isMac ? [{ role: "close" as const }] : commandMenuItems("quit")),
      ],
    },
    {
      label: t("menu.edit"),
      submenu: [
        { role: "undo", label: t("menu.undo") },
        { role: "redo", label: t("menu.redo") },
        { type: "separator" },
        { role: "cut", label: t("menu.cut") },
        { role: "copy", label: t("menu.copy") },
        { role: "paste", label: t("menu.paste") },
        { role: "selectAll", label: t("menu.selectAll") },
        { type: "separator" },
        ...commandMenuItems("copy-url"),
        { type: "separator" },
        ...commandMenuItems("find"),
        ...commandMenuItems("find-next"),
        ...commandMenuItems("find-previous"),
      ],
    },
    {
      label: t("menu.view"),
      submenu: [
        ...commandMenuItems("command-palette"),
        ...commandMenuItems("app-menu"),
        ...commandMenuItems("focus-address"),
        ...commandMenuItems("toggle-sidebar"),
        ...commandMenuItems("toggle-zen"),
        ...commandMenuItems("toggle-compact-mode"),
        ...commandMenuItems("toggle-sidebar-position"),
        ...commandMenuItems("toggle-reader"),
        ...commandMenuItems("toggle-mobile-site"),
        ...commandMenuItems("translate-page"),
        ...commandMenuItems("highlight-selection"),
        ...commandMenuItems("toggle-notes-panel"),
        ...commandMenuItems("toggle-assistant"),
        ...commandMenuItems("open-notes"),
        { type: "separator" },
        ...commandMenuItems("reload"),
        ...commandMenuItems("view-source"),
        ...commandMenuItems("devtools"),
        ...commandMenuItems("site-info"),
        ...commandMenuItems("page-options"),
        { type: "separator" },
        ...commandMenuItems("toggle-split", { id: "toggle-split" }),
        { type: "separator" },
        ...commandMenuItems("zoom-reset"),
        ...commandMenuItems("zoom-in"),
        ...commandMenuItems("zoom-out"),
        ...commandMenuItems("toggle-fullscreen"),
        { type: "separator" },
        ...commandMenuItems("picture-in-picture"),
        ...commandMenuItems("toggle-mute"),
        { type: "separator" },
        ...commandMenuItems("screenshot-visible"),
        ...commandMenuItems("screenshot-full"),
        ...commandMenuItems("screenshot-element"),
        ...commandMenuItems("record-video"),
      ],
    },
    {
      label: t("menu.navigation"),
      submenu: [
        ...commandMenuItems("back", { label: t("menu.back") }),
        ...commandMenuItems("forward", { label: t("menu.forward") }),
        { type: "separator" },
        { label: t("menu.nextTab"), accelerator: "Ctrl+Tab", click: withFocused((c) => c.tabs.cycle(1)) },
        { label: t("menu.previousTab"), accelerator: "Ctrl+Shift+Tab", click: withFocused((c) => c.tabs.cycle(-1)) },
        ...commandMenuItems("toggle-pin"),
        ...commandMenuItems("sleep-tab"),
        ...commandMenuItems("sleep-other-tabs"),
        ...commandMenuItems("select-all-tabs"),
        ...tabNumbers,
      ],
    },
    {
      label: t("menu.spaces"),
      submenu: [
        ...commandMenuItems("new-space", { id: "space-new" }),
        ...commandMenuItems("edit-space"),
        { type: "separator" },
        ...commandMenuItems("next-space", { id: "space-next" }),
        ...commandMenuItems("previous-space", { id: "space-previous" }),
        ...spaceNumbers,
      ],
    },
    {
      label: t("menu.bookmarks"),
      submenu: commandMenuItems("toggle-bookmark"),
    },
    {
      label: t("menu.help"),
      submenu: [...commandMenuItems("keyboard-shortcuts"), ...commandMenuItems("open-welcome"), ...commandMenuItems("report-issue"), { type: "separator" }, ...commandMenuItems("about")],
    },
    ...(app.isPackaged
      ? []
      : [{ label: "Dev", submenu: [{ role: "toggleDevTools" as const, label: t("menu.interfaceDevtools"), accelerator: "F12" }] }]),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  builtShortcuts = JSON.stringify(settings().shortcuts);
  builtUpdateReady = updateReady();
}
