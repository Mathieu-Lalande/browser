import { describe, expect, it } from "vitest";
import {
  afterMenuClick,
  badgeColor,
  canReadTab,
  createMenuItem,
  extensionMenuEntries,
  parseStoredMenus,
  manifestCommands,
  manifestTabAccess,
  matchesPattern,
  matchesTabQuery,
  menuClickInfo,
  menuItemFrom,
  parseExtensionMenuEntryId,
  redactTab,
  resolveAction,
  tabChange,
  withDescendants,
  type FullTab,
  type MenuItem,
  type MenuTarget,
} from "./extension-api";

const ID = "a".repeat(32);
const OTHER = "b".repeat(32);

const tab = (patch: Partial<FullTab> = {}): FullTab => ({
  id: 7,
  index: 0,
  windowId: 1,
  active: true,
  highlighted: true,
  selected: true,
  pinned: false,
  incognito: false,
  discarded: false,
  autoDiscardable: true,
  groupId: -1,
  status: "complete",
  url: "https://example.com/a",
  title: "Example",
  favIconUrl: "data:image/png;base64,AA==",
  ...patch,
});

describe("match patterns", () => {
  it("follows Chrome's rules for schemes, hosts, ports and paths", () => {
    expect(matchesPattern("<all_urls>", "https://a.b/")).toBe(true);
    expect(matchesPattern("<all_urls>", "chrome://newtab/")).toBe(false);
    expect(matchesPattern("*://*/*", "http://x.org/p?q")).toBe(true);
    expect(matchesPattern("*://*/*", "file:///etc/passwd")).toBe(false);
    expect(matchesPattern("https://*.example.com/*", "https://example.com/")).toBe(true);
    expect(matchesPattern("https://*.example.com/*", "https://a.b.example.com/x")).toBe(true);
    expect(matchesPattern("https://*.example.com/*", "https://notexample.com/")).toBe(false);
    expect(matchesPattern("https://*.example.com/*", "http://example.com/")).toBe(false);
    expect(matchesPattern("https://example.com/docs/*", "https://example.com/blog")).toBe(false);
    expect(matchesPattern("http://localhost:8080/*", "http://localhost:8080/x")).toBe(true);
    expect(matchesPattern("http://localhost:8080/*", "http://localhost:9090/x")).toBe(false);
    expect(matchesPattern("not a pattern", "https://example.com/")).toBe(false);
  });
});

describe("tab access", () => {
  const none = { tabs: false, hosts: [], activeTab: false };

  it("hides the URL, title and favicon without tabs, a matching host permission or an activeTab grant", () => {
    const hidden = redactTab(tab(), canReadTab(none, "https://example.com/a"));
    expect(hidden).not.toHaveProperty("url");
    expect(hidden).not.toHaveProperty("title");
    expect(hidden).not.toHaveProperty("favIconUrl");
    expect(hidden).toMatchObject({ id: 7, windowId: 1, active: true });
    expect(canReadTab({ ...none, tabs: true }, "https://example.com/a")).toBe(true);
    expect(canReadTab({ ...none, activeTab: true }, "https://example.com/a")).toBe(true);
    expect(canReadTab({ ...none, hosts: ["https://*.example.com/*"] }, "https://example.com/a")).toBe(true);
    expect(canReadTab({ ...none, hosts: ["https://*.example.com/*"] }, "https://other.org/a")).toBe(false);
    expect(redactTab(tab(), true)).toHaveProperty("url", "https://example.com/a");
  });

  it("reads what a manifest grants (MV2 hosts in permissions, MV3 host_permissions)", () => {
    expect(manifestTabAccess({ permissions: ["tabs", "activeTab", "https://a.org/*"], host_permissions: ["<all_urls>"] })).toEqual({
      tabs: true,
      hosts: ["https://a.org/*", "<all_urls>"],
      activeTab: true,
    });
    expect(manifestTabAccess(null)).toEqual({ tabs: false, hosts: [], activeTab: false });
  });

  it("filters onUpdated's changeInfo the same way", () => {
    const before = tab({ status: "loading" });
    const after = tab({ url: "https://example.com/b", title: "B" });
    expect(tabChange(before, after, true)).toEqual({ status: "complete", url: "https://example.com/b", title: "B" });
    expect(tabChange(before, after, false)).toEqual({ status: "complete" });
    expect(tabChange(after, after, true)).toBeNull();
  });

  it("answers tabs.query, URL and title filters only on readable tabs", () => {
    const windows = { current: 1, lastFocused: 2 };
    expect(matchesTabQuery(tab(), { active: true, currentWindow: true }, windows, false)).toBe(true);
    expect(matchesTabQuery(tab(), { lastFocusedWindow: true }, windows, false)).toBe(false);
    expect(matchesTabQuery(tab(), { windowId: -2 }, windows, false)).toBe(true);
    expect(matchesTabQuery(tab(), { url: "https://example.com/*" }, windows, true)).toBe(true);
    expect(matchesTabQuery(tab(), { url: "https://example.com/*" }, windows, false)).toBe(false);
    expect(matchesTabQuery(tab(), { title: "Ex*" }, windows, true)).toBe(true);
    expect(matchesTabQuery(tab(), { title: "Ex*" }, windows, false)).toBe(false);
  });
});

describe("chrome.action state", () => {
  it("resolves a tab's own values over the global ones", () => {
    const state = { global: { badgeText: "3", title: "T" }, tabs: { t1: { badgeText: "9" } } };
    expect(resolveAction(state, "t1")).toEqual({ badgeText: "9", title: "T" });
    expect(resolveAction(state, "t2")).toEqual({ badgeText: "3", title: "T" });
    expect(resolveAction(undefined, "t1")).toEqual({});
  });

  it("accepts badge colors as CSS strings or RGBA arrays", () => {
    expect(badgeColor("#d00000")).toBe("#d00000");
    expect(badgeColor([0, 128, 0, 255])).toBe("#008000");
    expect(badgeColor([0, 128, 0, 128])).toBe("#00800080");
    expect(badgeColor("red; background: url(x)")).toBeNull();
    expect(badgeColor(12)).toBeNull();
  });
});

describe("context menus", () => {
  const target = (patch: Partial<MenuTarget> = {}): MenuTarget => ({
    pageUrl: "https://example.com/",
    frameUrl: "https://example.com/",
    linkUrl: "",
    srcUrl: "",
    mediaType: "none",
    selectionText: "",
    isEditable: false,
    ...patch,
  });
  const create = (items: MenuItem[], props: Record<string, unknown>) => {
    const item = menuItemFrom(props, items);
    if (typeof item === "string") throw new Error(item);
    items.push(item);
    return items;
  };

  it("validates create and update properties", () => {
    const items = create([], { id: "a", title: "A" });
    expect(items[0]).toMatchObject({ id: "a", type: "normal", contexts: ["page"], enabled: true, visible: true, checked: false });
    expect(menuItemFrom({ id: "a", title: "again" }, items)).toMatch(/duplicate/);
    expect(menuItemFrom({ id: "b" }, items)).toMatch(/Title/);
    expect(menuItemFrom({ id: "b", title: "B", contexts: ["nowhere"] }, items)).toMatch(/contexts/);
    expect(menuItemFrom({ id: "b", title: "B", parentId: "missing" }, items)).toMatch(/Cannot find/);
    expect(menuItemFrom({ title: "itself", parentId: "a" }, items, items[0])).toMatch(/itself/);
    expect(menuItemFrom({ title: "Renamed", enabled: false }, items, items[0])).toMatchObject({ id: "a", title: "Renamed", enabled: false });
    expect(menuItemFrom({ id: 12, title: "number id" }, items)).toMatchObject({ id: "12" });
  });

  it("removes an item with its descendants", () => {
    const items = create(create(create([], { id: "p", title: "P" }), { id: "c", title: "C", parentId: "p" }), { id: "g", title: "G", parentId: "c" });
    expect([...withDescendants(items, "p")].sort()).toEqual(["c", "g", "p"]);
  });

  it("merges into the page menu as Chrome does: one item with the extension's icon, several under its name", () => {
    const single = create([], { id: "only", title: "Chercher « %s »", contexts: ["selection"] });
    const several = create(create([], { id: "x", title: "X", contexts: ["all"] }), { id: "y", title: "Y", contexts: ["link"] });
    const groups = [
      { extensionId: ID, name: "Une", icon: "data:image/png;base64,AA==", items: single },
      { extensionId: OTHER, name: "Deux", icon: null, items: several },
    ];
    // Nothing selected: the selection item stays out; the link item too.
    expect(extensionMenuEntries(groups, target())).toEqual([{ id: `ext-menu:${OTHER}:x`, label: "X", enabled: true }]);
    expect(extensionMenuEntries(groups, target({ selectionText: "chat", linkUrl: "https://a.org/" }))).toEqual([
      { id: `ext-menu:${ID}:only`, label: "Chercher « chat »", enabled: true, icon: "data:image/png;base64,AA==" },
      {
        id: `ext-group:${OTHER}`,
        label: "Deux",
        submenu: [
          { id: `ext-menu:${OTHER}:x`, label: "X", enabled: true },
          { id: `ext-menu:${OTHER}:y`, label: "Y", enabled: true },
        ],
      },
    ]);
  });

  it("follows parents, document patterns, visibility and radio groups", () => {
    let items = create([], { id: "p", title: "Parent", contexts: ["all"] });
    create(items, { id: "r1", title: "R1", type: "radio", parentId: "p", checked: true, contexts: ["all"] });
    create(items, { id: "r2", title: "R2", type: "radio", parentId: "p", contexts: ["all"] });
    create(items, { id: "hidden", title: "H", visible: false });
    create(items, { id: "docs", title: "Docs", documentUrlPatterns: ["https://docs.example.com/*"] });
    const entries = extensionMenuEntries([{ extensionId: ID, name: "Ext", icon: null, items }], target());
    expect(entries).toEqual([
      {
        id: `ext-menu:${ID}:p`,
        label: "Parent",
        enabled: true,
        submenu: [
          { id: `ext-menu:${ID}:r1`, label: "R1", enabled: true, checked: true, radio: true },
          { id: `ext-menu:${ID}:r2`, label: "R2", enabled: true, checked: false, radio: true },
        ],
      },
    ]);
    items = afterMenuClick(items, "r2");
    expect(items.filter((item) => item.type === "radio").map((item) => item.checked)).toEqual([false, true]);
    expect(menuClickInfo(items[2], target(), false)).toMatchObject({ menuItemId: "r2", parentMenuItemId: "p", checked: true, wasChecked: false, pageUrl: "https://example.com/" });
  });

  it("round-trips entry ids", () => {
    expect(parseExtensionMenuEntryId(`ext-menu:${ID}:a:b`)).toEqual({ extensionId: ID, itemId: "a:b" });
    expect(parseExtensionMenuEntryId("page-reload")).toBeNull();
  });
});

describe("chrome.commands", () => {
  it("lists the manifest's commands with the installed shortcuts (ADR-054)", () => {
    const raw = { commands: { "say-hello": { description: "Bonjour", suggested_key: { default: "Ctrl+Shift+Y" } }, other: {} } };
    expect(manifestCommands(raw)).toEqual([
      { name: "say-hello", description: "Bonjour", shortcut: "" },
      { name: "other", description: "", shortcut: "" },
    ]);
    expect(manifestCommands(raw, { "say-hello": "Ctrl+Shift+Y" })[0].shortcut).toBe("Ctrl+Shift+Y");
    expect(manifestCommands(raw, { toString: "x" } as Record<string, string>)[1].shortcut).toBe("");
    expect(manifestCommands({})).toEqual([]);
  });
});

describe("menus kept across restarts (ADR-054)", () => {
  const items = (): MenuItem[] => {
    const parent = menuItemFrom({ id: "parent", title: "Parent" }, []) as MenuItem;
    const child = menuItemFrom({ id: "child", title: "Enfant", parentId: "parent", type: "checkbox", checked: true }, [parent]) as MenuItem;
    return [parent, child];
  };

  it("reads back what was saved, validated again", () => {
    const stored = JSON.parse(JSON.stringify({ [ID]: items(), [OTHER]: [] }));
    expect(parseStoredMenus(stored)).toEqual({ [ID]: items() });
    // An orphan (its parent missing) and garbage are dropped; a bad extension key is skipped.
    expect(parseStoredMenus({ [ID]: [items()[1], { id: "ok", title: "OK" }, 42], "../x": items() })).toEqual({ [ID]: [menuItemFrom({ id: "ok", title: "OK" }, [])] });
    expect(parseStoredMenus([])).toBeNull();
    expect(parseStoredMenus("x")).toBeNull();
  });

  it("creates an item again over the restored one (no duplicate id error), else refuses duplicates", () => {
    const restored = new Set(["parent", "child"]);
    const again = createMenuItem(items(), { id: "parent", title: "Nouveau titre" }, restored);
    expect(again).not.toBeTypeOf("string");
    if (typeof again === "string") return;
    expect(again.items.map((item) => [item.id, item.title])).toEqual([
      ["parent", "Nouveau titre"],
      ["child", "Enfant"],
    ]);
    expect(createMenuItem(items(), { id: "parent", title: "Deux fois" })).toBe("Cannot create item with duplicate id parent");
    const added = createMenuItem(items(), { id: "new", title: "Nouveau" });
    expect(typeof added !== "string" && added.items.map((item) => item.id)).toEqual(["parent", "child", "new"]);
    expect(createMenuItem([], { title: "" })).toBeTypeOf("string");
  });
});
