import { Menu, app, type MenuItemConstructorOptions } from "electron";
import { commandMenuItems } from "./commands";
import { onSettingsChanged, settings } from "./settings";
import { BrowserController } from "./window";

/** Shortcuts the current menu was built with: the menu is rebuilt when the user changes them (ADR-028). */
let builtShortcuts: string | null = null;

onSettingsChanged((current) => {
  if (builtShortcuts !== null && JSON.stringify(current.shortcuts) !== builtShortcuts) installMenu();
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
    label: i === 8 ? "Dernier onglet" : `Onglet ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: withFocused((c) => c.tabs.activateIndex(i === 8 ? -1 : i)),
  }));

  const spaceNumbers: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    id: `space-${i + 1}`,
    label: i === 8 ? "Dernier espace" : `Espace ${i + 1}`,
    accelerator: `CmdOrCtrl+Alt+${i + 1}`,
    click: withFocused((c) => c.spaces.switchIndex(i === 8 ? -1 : i)),
  }));

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "Fichier",
      submenu: [
        ...commandMenuItems("new-tab"),
        ...commandMenuItems("new-window"),
        ...commandMenuItems("new-private-window"),
        ...commandMenuItems("duplicate-tab"),
        ...commandMenuItems("open-downloads"),
        ...commandMenuItems("open-settings"),
        ...commandMenuItems("close-tab"),
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit", label: "Quitter" },
      ],
    },
    {
      label: "Édition",
      submenu: [
        { role: "undo", label: "Annuler" },
        { role: "redo", label: "Rétablir" },
        { type: "separator" },
        { role: "cut", label: "Couper" },
        { role: "copy", label: "Copier" },
        { role: "paste", label: "Coller" },
        { role: "selectAll", label: "Tout sélectionner" },
        { type: "separator" },
        ...commandMenuItems("copy-url"),
        { type: "separator" },
        ...commandMenuItems("find"),
        ...commandMenuItems("find-next"),
        ...commandMenuItems("find-previous"),
      ],
    },
    {
      label: "Affichage",
      submenu: [
        ...commandMenuItems("command-palette"),
        ...commandMenuItems("focus-address"),
        ...commandMenuItems("toggle-sidebar"),
        ...commandMenuItems("toggle-zen"),
        ...commandMenuItems("toggle-reader"),
        ...commandMenuItems("toggle-mobile-site"),
        { type: "separator" },
        ...commandMenuItems("reload"),
        ...commandMenuItems("devtools"),
        ...commandMenuItems("site-info"),
        { type: "separator" },
        ...commandMenuItems("toggle-split", { id: "toggle-split" }),
        { type: "separator" },
        ...commandMenuItems("zoom-reset"),
        ...commandMenuItems("zoom-in"),
        ...commandMenuItems("zoom-out"),
        { role: "togglefullscreen", label: "Plein écran" },
        { type: "separator" },
        ...commandMenuItems("picture-in-picture"),
        ...commandMenuItems("toggle-mute"),
      ],
    },
    {
      label: "Navigation",
      submenu: [
        ...commandMenuItems("back", { label: "Précédent" }),
        ...commandMenuItems("forward", { label: "Suivant" }),
        { type: "separator" },
        { label: "Onglet suivant", accelerator: "Ctrl+Tab", click: withFocused((c) => c.tabs.cycle(1)) },
        { label: "Onglet précédent", accelerator: "Ctrl+Shift+Tab", click: withFocused((c) => c.tabs.cycle(-1)) },
        ...commandMenuItems("toggle-pin"),
        ...commandMenuItems("sleep-tab"),
        ...commandMenuItems("sleep-other-tabs"),
        ...tabNumbers,
      ],
    },
    {
      label: "Espaces",
      submenu: [
        ...commandMenuItems("new-space", { id: "space-new" }),
        { type: "separator" },
        ...commandMenuItems("next-space", { id: "space-next" }),
        ...commandMenuItems("previous-space", { id: "space-previous" }),
        ...spaceNumbers,
      ],
    },
    {
      label: "Favoris",
      submenu: commandMenuItems("toggle-bookmark"),
    },
    ...(app.isPackaged
      ? []
      : [{ label: "Dev", submenu: [{ role: "toggleDevTools" as const, label: "DevTools de l'interface", accelerator: "F12" }] }]),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  builtShortcuts = JSON.stringify(settings().shortcuts);
}
