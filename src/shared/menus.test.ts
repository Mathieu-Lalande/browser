import { describe, expect, it } from "vitest";
import { isCommandId } from "./commands";
import { buildAppMenu, buildSidebarMenu, buildSpaceMenu, menuCommands, nodeLabel, type MenuNode } from "./menus";
import type { TabState } from "./types";

const tab = (overrides: Partial<TabState> = {}): TabState =>
  ({ id: "t1", url: "https://example.com/", title: "Example", canGoBack: false, canGoForward: false, isBookmarked: false, ...overrides }) as TabState;

const find = (nodes: readonly MenuNode[], id: string): MenuNode | undefined => {
  for (const node of nodes) {
    if ("id" in node && node.id === id) return node;
    if (node.kind === "submenu") {
      const inner = find(node.children, id);
      if (inner) return inner;
    }
  }
  return undefined;
};

describe("app menu", () => {
  const context = { activeTab: tab(), isPrivate: false, history: [{ url: "https://a.example/", title: "A" }], favorites: [], bookmarks: [] };

  it("is built from registry commands, with the sync header and the zoom row", () => {
    const menu = buildAppMenu(context);
    expect(menu[0]).toEqual({ kind: "sync" });
    expect(menu.some((node) => node.kind === "zoom")).toBe(true);
    const ids = menuCommands(menu);
    expect(ids.every(isCommandId)).toBe(true);
    const expected = [
      "new-tab",
      "new-window",
      "new-private-window",
      "open-downloads",
      "open-passwords",
      "open-extensions",
      "print",
      "save-page",
      "find",
      "open-settings",
      "quit",
      // Plus d'outils and Aide.
      "screenshot-visible",
      "screenshot-full",
      "screenshot-element",
      "record-video",
      "toggle-reader",
      "toggle-mobile-site",
      "open-boosts",
      "zap-elements",
      "view-source",
      "devtools",
      "keyboard-shortcuts",
      "about",
      "report-issue",
    ] as const;
    for (const id of expected) expect(ids).toContain(id);
    expect(ids).toContain("translate-page");
    expect(nodeLabel(buildAppMenu({ ...context, activeTab: tab({ translated: true }) }).find((node) => node.kind === "command" && node.id === "translate-page")!)).toBe("Afficher l'original");
  });

  it("lists recent history and offers to reopen a closed tab", () => {
    const history = find(buildAppMenu(context), "history");
    expect(history?.kind === "submenu" && history.children.map((node) => node.kind)).toEqual(["link", "separator", "command", "command"]);
    expect(find(buildAppMenu(context), "history-0")).toMatchObject({ url: "https://a.example/", label: "A" });
  });

  it("disables page commands without a web page, and has no boosts in private windows", () => {
    const start = buildAppMenu({ ...context, activeTab: tab({ url: "" }) });
    expect(find(start, "print")).toMatchObject({ enabled: false });
    expect(find(start, "new-tab")).toMatchObject({ enabled: true });
    expect(menuCommands(buildAppMenu({ ...context, isPrivate: true }))).not.toContain("open-boosts");
  });
});

describe("sidebar menu", () => {
  const context = { activeTab: tab({ isBookmarked: true }), isPrivate: false, compact: true, sidebarPosition: "left" as const, tabCount: 3, canReopen: false };

  it("has the Zen entries, labelled after the state", () => {
    const menu = buildSidebarMenu(context);
    expect(menuCommands(menu)).toEqual([
      "toggle-compact-mode",
      "new-tab",
      "new-folder",
      "reload",
      "toggle-bookmark",
      "select-all-tabs",
      "reopen-closed-tab",
      "toggle-sidebar-position",
      "edit-space",
    ]);
    expect(find(menu, "toggle-compact-mode")).toMatchObject({ checked: true });
    expect(nodeLabel(find(menu, "toggle-sidebar-position")!)).toBe("Barre latérale à droite");
    expect(nodeLabel(find(menu, "toggle-bookmark")!)).toBe("Retirer l'onglet des favoris");
    expect(find(menu, "reopen-closed-tab")).toMatchObject({ enabled: false });
    expect(menuCommands(buildSidebarMenu({ ...context, isPrivate: true }))).not.toContain("edit-space");
  });
});

describe("space menu", () => {
  it("moves within bounds and never deletes the last space", () => {
    const first = buildSpaceMenu({ index: 0, count: 1, canCreate: true });
    expect(find(first, "space-move-left")).toMatchObject({ enabled: false });
    expect(find(first, "space-move-right")).toMatchObject({ enabled: false });
    expect(find(first, "space-delete")).toMatchObject({ enabled: false });
    const middle = buildSpaceMenu({ index: 1, count: 3, canCreate: false });
    expect(find(middle, "space-move-left")).toMatchObject({ enabled: true });
    expect(find(middle, "space-delete")).toMatchObject({ enabled: true });
    expect(find(middle, "new-space")).toMatchObject({ enabled: false });
  });
});
