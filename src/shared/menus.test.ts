import { describe, expect, it } from "vitest";
import { isCommandId } from "./commands";
import {
  buildAppMenu,
  buildSidebarMenu,
  closedEntryOf,
  buildSpaceMenu,
  menuCommands,
  nodeLabel,
  profileEntryOf,
  toolsMenuGroups,
  type MenuNode,
} from "./menus";
import type { ProfilesView } from "./profiles";
import type { TabState } from "./types";

const tab = (overrides: Partial<TabState> = {}): TabState =>
  ({
    id: "t1",
    url: "https://example.com/",
    title: "Example",
    canGoBack: false,
    canGoForward: false,
    isBookmarked: false,
    ...overrides,
  }) as TabState;

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
  const context = {
    activeTab: tab(),
    isPrivate: false,
    history: [{ url: "https://a.example/", title: "A" }],
    favorites: [],
    bookmarks: [],
  };

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
    expect(
      nodeLabel(
        buildAppMenu({ ...context, activeTab: tab({ translated: true }) }).find(
          (node) => node.kind === "command" && node.id === "translate-page",
        )!,
      ),
    ).toBe("Afficher l'original");
  });

  it("lists recent history and offers to reopen a closed tab", () => {
    const history = find(buildAppMenu(context), "history");
    expect(
      history?.kind === "submenu" && history.children.map((node) => node.kind),
    ).toEqual(["link", "separator", "command", "command", "command"]);
    expect(find(buildAppMenu(context), "history-0")).toMatchObject({
      url: "https://a.example/",
      label: "A",
    });
  });

  it("lists recently closed windows and tabs (ADR-042)", () => {
    const closed = {
      windows: [{ index: 0, title: "Docs", tabCount: 3 }],
      tabs: [{ index: 0, title: "", url: "https://b.example/" }],
    };
    const menu = buildAppMenu({ ...context, closed });
    expect(find(menu, "closed-window-0")).toMatchObject({
      kind: "action",
      label: "Docs (3 onglets)",
    });
    expect(find(menu, "closed-tab-0")).toMatchObject({
      kind: "action",
      label: "https://b.example/",
    });
    expect(closedEntryOf("closed-tab-12")).toEqual({ kind: "tab", index: 12 });
    expect(closedEntryOf("history-0")).toBeNull();
    const reopen = find(
      buildAppMenu({ ...context, closed: { windows: [], tabs: [] } }),
      "reopen-closed-window",
    );
    expect(reopen).toMatchObject({ enabled: false });
  });

  it("disables page commands without a web page, and has no boosts in private windows", () => {
    const start = buildAppMenu({ ...context, activeTab: tab({ url: "" }) });
    expect(find(start, "print")).toMatchObject({ enabled: false });
    expect(find(start, "new-tab")).toMatchObject({ enabled: true });
    expect(
      menuCommands(buildAppMenu({ ...context, isPrivate: true })),
    ).not.toContain("open-boosts");
  });

  it("reaches every internal page, each once, in the order of the sidebar Outils menu", () => {
    const ids = menuCommands(buildAppMenu({ ...context, profiles: PROFILES }));
    const pages = [
      "open-history",
      "open-downloads",
      "open-passwords",
      "open-autofill",
      "open-notes",
      "open-boosts",
      "open-extensions",
    ] as const;
    for (const id of [
      ...pages,
      "open-archive",
      "import-data",
      "open-task-manager",
      "open-profiles",
      "open-settings",
    ] as const)
      expect(ids.filter((x) => x === id)).toHaveLength(1);
    const library = toolsMenuGroups(false)
      .flat()
      .filter(
        (id) =>
          ids.includes(id) &&
          id !== "open-task-manager" &&
          id !== "open-profiles",
      );
    expect(ids.filter((id) => library.includes(id))).toEqual(library);
    expect(toolsMenuGroups(true).flat()).not.toContain("open-boosts");
  });

  it("has a Profils submenu: the current profile, the others to open, manage and create (ADR-042)", () => {
    const profiles = find(
      buildAppMenu({ ...context, profiles: PROFILES }),
      "profiles",
    );
    expect(profiles).toMatchObject({
      kind: "submenu",
      label: "Profil : Travail",
      icon: "briefcase",
      color: "#16a34a",
    });
    const children = profiles?.kind === "submenu" ? profiles.children : [];
    expect(
      children.map((node) => ("id" in node ? node.id : node.kind)),
    ).toEqual([
      "profile-current",
      "separator",
      "profile-open-default",
      "separator",
      "open-profiles",
      "new-profile",
    ]);
    expect(find(children, "profile-open-default")).toMatchObject({
      label: "Ouvrir Personnel",
      color: "#4f7cff",
    });
    expect(profileEntryOf("profile-open-default")).toBe("default");
    expect(profileEntryOf("profile-current")).toBeNull();
    expect(
      menuCommands(
        buildAppMenu({ ...context, isPrivate: true, profiles: PROFILES }),
      ),
    ).not.toContain("new-profile");
    expect(find(buildAppMenu(context), "profiles")).toBeUndefined();
  });
});

const PROFILES: ProfilesView = {
  profiles: [
    {
      id: "default",
      name: "Personnel",
      color: "#4f7cff",
      icon: "circle-user",
      createdAt: 0,
    },
    {
      id: "work",
      name: "Travail",
      color: "#16a34a",
      icon: "briefcase",
      createdAt: 1,
    },
  ],
  current: "work",
  lastUsed: "work",
  askOnLaunch: false,
};

describe("sidebar menu", () => {
  const context = {
    activeTab: tab({ isBookmarked: true }),
    isPrivate: false,
    compact: true,
    sidebarPosition: "left" as const,
    tabCount: 3,
    canReopen: false,
  };

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
    expect(nodeLabel(find(menu, "toggle-sidebar-position")!)).toBe(
      "Barre latérale à droite",
    );
    expect(nodeLabel(find(menu, "toggle-bookmark")!)).toBe(
      "Retirer l'onglet des favoris",
    );
    expect(find(menu, "reopen-closed-tab")).toMatchObject({ enabled: false });
    expect(
      menuCommands(buildSidebarMenu({ ...context, isPrivate: true })),
    ).not.toContain("edit-space");
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
