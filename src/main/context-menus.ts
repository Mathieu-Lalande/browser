import { Menu, type MenuItemConstructorOptions } from "electron";
import { effectiveAccelerator } from "@shared/commands";
import { buildSidebarMenu, buildSpaceMenu, nodeLabel, type MenuNode, type SpaceUiAction } from "@shared/menus";
import { MAX_SPACES } from "@shared/spaces";
import type { SpaceId } from "@shared/types";
import { runCommand } from "./commands";
import { settings } from "./settings";
import { spaces } from "./spaces";
import type { BrowserController } from "./window";

/**
 * Native menus of the sidebar (ADR-033), like the tab menu: the empty area's and the space
 * chips'. Built from the pure models of `@shared/menus` on every right click.
 */

/**
 * Menu items for model nodes: commands run through the registry and show their effective
 * shortcut as a hint (`registerAccelerator: false`: the application menu owns the shortcuts).
 */
export function nativeTemplate(nodes: readonly MenuNode[], c: BrowserController, act: (id: string) => void = () => {}): MenuItemConstructorOptions[] {
  return nodes.flatMap((node): MenuItemConstructorOptions[] => {
    switch (node.kind) {
      case "separator":
        return [{ type: "separator" }];
      case "command":
        return [
          {
            id: node.id,
            label: nodeLabel(node),
            enabled: node.enabled,
            accelerator: effectiveAccelerator(node.id, process.platform, settings().shortcuts),
            registerAccelerator: false,
            ...(node.checked === undefined ? {} : { type: "checkbox" as const, checked: node.checked }),
            click: () => runCommand(node.id, c),
          },
        ];
      case "action":
        return [{ id: node.id, label: node.hint ? `${node.label} (${node.hint})` : node.label, enabled: node.enabled, click: () => act(node.id) }];
      case "link":
        return [{ id: node.id, label: node.label, click: () => act(node.id) }];
      case "submenu":
        return [{ id: node.id, label: node.label, enabled: node.enabled, submenu: nativeTemplate(node.children, c, act) }];
      default:
        // The app menu's sync header and zoom row exist in the overlay version only.
        return [];
    }
  });
}

/** Right click on the sidebar's empty space. */
export function buildSidebarContextMenu(c: BrowserController): Menu {
  const { tabs, activeTabId } = c.tabs.getState();
  const layout = settings().layout;
  const nodes = buildSidebarMenu({
    activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
    isPrivate: c.isPrivate,
    compact: layout.compactMode,
    sidebarPosition: layout.sidebarPosition,
    tabCount: tabs.length,
    canReopen: c.tabs.canReopenClosed,
  });
  return Menu.buildFromTemplate(nativeTemplate(nodes, c));
}

export function showSidebarMenu(c: BrowserController): void {
  buildSidebarContextMenu(c).popup({ window: c.window });
}

/** What the space menu does in main; the editor entries go back to the chrome UI. */
function runSpaceAction(c: BrowserController, spaceId: SpaceId, id: string): void {
  switch (id as SpaceUiAction | "space-move-left" | "space-move-right" | "space-delete") {
    case "space-rename":
      return c.sendUiCommand(`rename-space:${spaceId}`);
    case "space-edit":
      return c.sendUiCommand(`edit-space:${spaceId}`);
    case "space-move-left":
      return spaces.move(spaceId, -1);
    case "space-move-right":
      return spaces.move(spaceId, 1);
    case "space-delete": {
      const space = spaces.get(spaceId);
      if (!space) return;
      c.sendUiCommand(`edit-space:${spaceId}`);
    }
  }
}

/** Right click on a space chip (never in a private window: it has no space switcher). */
export function buildSpaceContextMenu(c: BrowserController, spaceId: SpaceId): Menu | null {
  const list = spaces.list();
  const index = list.findIndex((space) => space.id === spaceId);
  if (c.isPrivate || index === -1) return null;
  const nodes = buildSpaceMenu({ index, count: list.length, canCreate: list.length < MAX_SPACES });
  return Menu.buildFromTemplate(nativeTemplate(nodes, c, (id) => void runSpaceAction(c, spaceId, id)));
}

export function showSpaceMenu(c: BrowserController, spaceId: SpaceId): void {
  buildSpaceContextMenu(c, spaceId)?.popup({ window: c.window });
}
