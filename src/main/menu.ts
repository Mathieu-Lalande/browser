import { Menu, app, type MenuItemConstructorOptions } from "electron";
import { commandMenuItem } from "./commands";
import { BrowserController } from "./window";

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
        commandMenuItem("new-tab"),
        commandMenuItem("new-window"),
        commandMenuItem("new-private-window"),
        commandMenuItem("duplicate-tab"),
        commandMenuItem("open-downloads"),
        commandMenuItem("open-settings"),
        commandMenuItem("close-tab"),
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
        commandMenuItem("copy-url"),
        { type: "separator" },
        commandMenuItem("find"),
        commandMenuItem("find-next"),
        commandMenuItem("find-previous"),
        // Ctrl+G / Ctrl+Shift+G, as in Chrome (macOS already uses Cmd+G as the main shortcut).
        ...(isMac
          ? []
          : [
              commandMenuItem("find-next", { accelerator: "CmdOrCtrl+G", visible: false }),
              commandMenuItem("find-previous", { accelerator: "CmdOrCtrl+Shift+G", visible: false }),
            ]),
      ],
    },
    {
      label: "Affichage",
      submenu: [
        commandMenuItem("command-palette"),
        commandMenuItem("focus-address"),
        commandMenuItem("toggle-sidebar"),
        commandMenuItem("toggle-zen"),
        { type: "separator" },
        commandMenuItem("reload"),
        commandMenuItem("reload", { accelerator: "F5", visible: false }),
        commandMenuItem("devtools"),
        commandMenuItem("site-info"),
        { type: "separator" },
        commandMenuItem("toggle-split", { id: "toggle-split" }),
        { type: "separator" },
        commandMenuItem("zoom-reset"),
        commandMenuItem("zoom-in"),
        // Ctrl+Plus (Shift+= on most layouts) zooms in too.
        commandMenuItem("zoom-in", { accelerator: "CmdOrCtrl+Plus", visible: false }),
        commandMenuItem("zoom-out"),
        { role: "togglefullscreen", label: "Plein écran" },
        { type: "separator" },
        commandMenuItem("picture-in-picture"),
        commandMenuItem("toggle-mute"),
      ],
    },
    {
      label: "Navigation",
      submenu: [
        commandMenuItem("back", { label: "Précédent" }),
        commandMenuItem("forward", { label: "Suivant" }),
        { type: "separator" },
        { label: "Onglet suivant", accelerator: "Ctrl+Tab", click: withFocused((c) => c.tabs.cycle(1)) },
        { label: "Onglet précédent", accelerator: "Ctrl+Shift+Tab", click: withFocused((c) => c.tabs.cycle(-1)) },
        commandMenuItem("toggle-pin"),
        commandMenuItem("sleep-tab"),
        commandMenuItem("sleep-other-tabs"),
        ...tabNumbers,
      ],
    },
    {
      label: "Espaces",
      submenu: [
        commandMenuItem("new-space", { id: "space-new" }),
        { type: "separator" },
        commandMenuItem("next-space", { id: "space-next" }),
        commandMenuItem("previous-space", { id: "space-previous" }),
        ...spaceNumbers,
      ],
    },
    {
      label: "Favoris",
      submenu: [commandMenuItem("toggle-bookmark")],
    },
    ...(app.isPackaged
      ? []
      : [{ label: "Dev", submenu: [{ role: "toggleDevTools" as const, label: "DevTools de l'interface", accelerator: "F12" }] }]),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
