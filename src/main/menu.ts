import { Menu, app, type MenuItemConstructorOptions } from "electron";
import { BrowserController } from "./window";

/** Run an action against the focused browser window, if any. */
function withFocused(action: (controller: BrowserController) => void): () => void {
  return () => {
    const controller = BrowserController.focused();
    if (controller) action(controller);
  };
}

function withActiveTab(action: (controller: BrowserController, tabId: string) => void): () => void {
  return withFocused((controller) => {
    const tabId = controller.tabs.activeTabId;
    if (tabId) action(controller, tabId);
  });
}

/**
 * The application menu doubles as the keyboard shortcut registry: accelerators fire
 * whichever view (chrome UI or web page) has focus.
 */
export function installMenu(): void {
  const isMac = process.platform === "darwin";
  const tabNumbers: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    label: i === 8 ? "Dernier onglet" : `Onglet ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: withFocused((c) => c.tabs.activateIndex(i === 8 ? -1 : i)),
  }));

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "Fichier",
      submenu: [
        {
          label: "Nouvel onglet",
          accelerator: "CmdOrCtrl+T",
          click: withFocused((c) => {
            c.tabs.create();
            c.sendUiCommand("focus-address");
          }),
        },
        { label: "Nouvelle fenêtre", accelerator: "CmdOrCtrl+N", click: () => new BrowserController() },
        { label: "Fermer l'onglet", accelerator: "CmdOrCtrl+W", click: withActiveTab((c, id) => c.tabs.close(id)) },
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
      ],
    },
    {
      label: "Affichage",
      submenu: [
        { label: "Barre d'adresse", accelerator: "CmdOrCtrl+L", click: withFocused((c) => c.sendUiCommand("focus-address")) },
        { label: "Barre latérale", accelerator: "CmdOrCtrl+S", click: withFocused((c) => c.sendUiCommand("toggle-sidebar")) },
        { type: "separator" },
        { label: "Actualiser", accelerator: "CmdOrCtrl+R", click: withActiveTab((c, id) => c.tabs.reload(id)) },
        { label: "Actualiser", accelerator: "F5", visible: false, click: withActiveTab((c, id) => c.tabs.reload(id)) },
        {
          label: "Outils de développement",
          accelerator: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I",
          click: withFocused((c) => c.tabs.activeWebContents()?.toggleDevTools()),
        },
        { type: "separator" },
        { role: "resetZoom", label: "Taille réelle" },
        { role: "zoomIn", label: "Zoom avant" },
        { role: "zoomOut", label: "Zoom arrière" },
        { role: "togglefullscreen", label: "Plein écran" },
      ],
    },
    {
      label: "Navigation",
      submenu: [
        { label: "Précédent", accelerator: isMac ? "Cmd+[" : "Alt+Left", click: withActiveTab((c, id) => c.tabs.back(id)) },
        { label: "Suivant", accelerator: isMac ? "Cmd+]" : "Alt+Right", click: withActiveTab((c, id) => c.tabs.forward(id)) },
        { type: "separator" },
        { label: "Onglet suivant", accelerator: "Ctrl+Tab", click: withFocused((c) => c.tabs.cycle(1)) },
        { label: "Onglet précédent", accelerator: "Ctrl+Shift+Tab", click: withFocused((c) => c.tabs.cycle(-1)) },
        ...tabNumbers,
      ],
    },
    ...(app.isPackaged
      ? []
      : [{ label: "Dev", submenu: [{ role: "toggleDevTools" as const, label: "DevTools de l'interface", accelerator: "F12" }] }]),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
