import { Menu, type BaseWindow, type MenuItemConstructorOptions } from "electron";
import type { ExtensionInfo } from "@shared/extensions";
import type { Bounds } from "@shared/types";

/** What the extension menus act through (the window and the extension facades). */
export interface ExtensionMenuHost {
  readonly window: BaseWindow;
  list(): ExtensionInfo[];
  openPopup(id: string, anchor: Bounds): void;
  setPinned(id: string, pinned: boolean): void;
  openExtensionsPage(): void;
}

/**
 * Native menus of the sidebar's extension row (ADR-049): the puzzle button lists every extension
 * with a toolbar button (open its popup, pin or unpin it); a right click on a button offers to
 * unpin it. Native, like the sidebar's other menus: the chrome UI cannot draw over the pages.
 */
export function extensionMenuTemplate(host: ExtensionMenuHost, id: string | null, anchor: Bounds): MenuItemConstructorOptions[] {
  const withAction = host.list().filter((extension) => extension.enabled && extension.action);
  const manage: MenuItemConstructorOptions = { label: "Gérer les extensions", click: () => host.openExtensionsPage() };
  const one = id ? withAction.find((extension) => extension.id === id) : undefined;
  if (one) {
    return [
      { label: one.name, enabled: false },
      { type: "separator" },
      { label: one.pinned ? "Désépingler" : "Épingler", click: () => host.setPinned(one.id, !one.pinned) },
      manage,
    ];
  }
  const items: MenuItemConstructorOptions[] = withAction.map((extension) => ({
    label: extension.name,
    enabled: !!extension.action?.hasPopup,
    click: () => host.openPopup(extension.id, anchor),
  }));
  const pins: MenuItemConstructorOptions[] = withAction.map((extension) => ({
    label: extension.name,
    type: "checkbox",
    checked: extension.pinned,
    click: () => host.setPinned(extension.id, !extension.pinned),
  }));
  return [
    ...(items.length ? items : [{ label: "Aucune extension avec bouton", enabled: false }]),
    { type: "separator" },
    ...(pins.length ? [{ label: "Épingler dans la barre latérale", submenu: pins }] : []),
    manage,
  ];
}

export function showExtensionMenu(host: ExtensionMenuHost, id: string | null, anchor: Bounds): void {
  Menu.buildFromTemplate(extensionMenuTemplate(host, id, anchor)).popup({ window: host.window, x: Math.round(anchor.x), y: Math.round(anchor.y + anchor.height) });
}
