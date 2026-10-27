import { DEFAULT_SPACE } from "@shared/spaces";
import {
  activeTab,
  initialTabsModel,
  liveTabIds,
  orderedTabs,
  parseSession,
  PRIVATE_SPACE_ID,
  serializeSession,
  swipeTarget,
  tabsReducer,
  type TabsAction,
  type TabsModel,
} from "./tabs";

const run = (actions: TabsAction[], model: TabsModel = initialTabsModel()) => actions.reduce(tabsReducer, model);
const open = (id: string, url = `https://${id}.example/`, extra: Partial<Extract<TabsAction, { type: "open" }>> = {}): TabsAction => ({
  type: "open",
  id,
  url,
  now: Number(id.replace(/\D/g, "")) || 1,
  ...extra,
});

describe("tabsReducer", () => {
  it("opens and activates tabs in the shown space", () => {
    const model = run([open("t1"), open("t2")]);
    expect(model.tabs.map((tab) => tab.id)).toEqual(["t1", "t2"]);
    expect(activeTab(model)?.id).toBe("t2");
    expect(model.tabs[0].spaceId).toBe(DEFAULT_SPACE.id);
    expect(model.tabs[1].load).toEqual({ url: "https://t2.example/", seq: 2 });
  });

  it("opens background tabs without activating them, after a given tab", () => {
    const model = run([open("t1"), open("t2"), open("t3", undefined, { background: true, afterId: "t1" })]);
    expect(model.tabs.map((tab) => tab.id)).toEqual(["t1", "t3", "t2"]);
    expect(activeTab(model)?.id).toBe("t2");
  });

  it("activates the next tab (or the previous one) on close", () => {
    const base = run([open("t1"), open("t2"), open("t3"), { type: "activate", id: "t2", now: 10 }]);
    expect(activeTab(run([{ type: "close", id: "t2", activates: "next", now: 11 }], base))?.id).toBe("t3");
    expect(activeTab(run([{ type: "close", id: "t2", activates: "previous", now: 11 }], base))?.id).toBe("t1");
    const recent = run([{ type: "activate", id: "t1", now: 20 }, { type: "activate", id: "t2", now: 21 }], base);
    expect(activeTab(run([{ type: "close", id: "t2", activates: "recent", now: 22 }], recent))?.id).toBe("t1");
  });

  it("leaves no active tab when the last one closes", () => {
    const model = run([open("t1"), { type: "close", id: "t1", activates: "next", now: 2 }]);
    expect(model.tabs).toEqual([]);
    expect(activeTab(model)).toBeNull();
  });

  it("closes several tabs at once", () => {
    const model = run([open("t1"), open("t2"), open("t3"), { type: "close-many", ids: ["t2", "t3"], now: 5 }]);
    expect(model.tabs.map((tab) => tab.id)).toEqual(["t1"]);
    expect(activeTab(model)?.id).toBe("t1");
  });

  it("bumps the load sequence on explicit loads only", () => {
    let model = run([open("t1")]);
    const seq = model.tabs[0].load.seq;
    model = tabsReducer(model, { type: "navigation", id: "t1", url: "https://t1.example/page", title: "Page", isLoading: false, canGoBack: true, canGoForward: false });
    expect(model.tabs[0].load.seq).toBe(seq);
    expect(model.tabs[0]).toMatchObject({ url: "https://t1.example/page", title: "Page", canGoBack: true, progress: 1 });
    model = tabsReducer(model, { type: "load", id: "t1", url: "https://other.example/" });
    expect(model.tabs[0].load).toEqual({ url: "https://other.example/", seq: seq + 1 });
    expect(model.tabs[0].isLoading).toBe(true);
  });

  it("ignores navigation reports for non-navigable or blank URLs", () => {
    const model = run([open("t1")]);
    const next = tabsReducer(model, { type: "navigation", id: "t1", url: "javascript:alert(1)", title: "x", isLoading: false, canGoBack: false, canGoForward: false });
    expect(next.tabs[0].url).toBe("https://t1.example/");
    const blank = tabsReducer(model, { type: "navigation", id: "t1", url: "about:blank", title: "", isLoading: true, canGoBack: false, canGoForward: false });
    expect(blank.tabs[0].url).toBe("https://t1.example/");
  });

  it("returns the same model when nothing changes", () => {
    const model = run([open("t1"), { type: "pin", id: "t1", pinned: true }]);
    expect(tabsReducer(model, { type: "pin", id: "t1", pinned: true })).toBe(model);
    expect(tabsReducer(model, { type: "progress", id: "missing", progress: 0.5 })).toBe(model);
  });

  it("duplicates a tab right after it", () => {
    const model = run([open("t1"), open("t2"), { type: "duplicate", id: "t1", newId: "t9", now: 9 }]);
    expect(model.tabs.map((tab) => tab.id)).toEqual(["t1", "t9", "t2"]);
    expect(model.tabs[1].url).toBe("https://t1.example/");
    expect(activeTab(model)?.id).toBe("t9");
  });

  it("orders pinned tabs first", () => {
    const model = run([open("t1"), open("t2"), { type: "pin", id: "t2", pinned: true }]);
    expect(orderedTabs(model).map((tab) => tab.id)).toEqual(["t2", "t1"]);
  });

  it("manages spaces: add, show, move tabs, remove (closing their tabs)", () => {
    let model = run([open("t1"), open("t2"), { type: "add-space", id: "work", input: { name: "Travail" } }]);
    expect(model.activeSpaceId).toBe("work");
    expect(activeTab(model)).toBeNull();
    model = tabsReducer(model, { type: "move-to-space", id: "t1", spaceId: "work", now: 5 });
    expect(model.tabs.find((tab) => tab.id === "t1")?.spaceId).toBe("work");
    expect(activeTab(model)?.id).toBe("t1");
    model = tabsReducer(model, { type: "show-space", spaceId: DEFAULT_SPACE.id });
    expect(activeTab(model)?.id).toBe("t2");
    model = tabsReducer(model, { type: "remove-space", id: "work" });
    expect(model.spaces.map((space) => space.id)).toEqual([DEFAULT_SPACE.id]);
    expect(model.tabs.map((tab) => tab.id)).toEqual(["t2"]);
  });

  it("refuses the private pseudo space as a real space or move target", () => {
    let model = run([open("t1"), { type: "add-space", id: PRIVATE_SPACE_ID }]);
    expect(model.spaces).toHaveLength(1);
    model = tabsReducer(model, { type: "move-to-space", id: "t1", spaceId: PRIVATE_SPACE_ID, now: 3 });
    expect(model.tabs[0].spaceId).toBe(DEFAULT_SPACE.id);
  });

  it("keeps private tabs in their own group", () => {
    const model = run([open("t1"), open("p2", undefined, { spaceId: PRIVATE_SPACE_ID })]);
    expect(model.activeSpaceId).toBe(PRIVATE_SPACE_ID);
    expect(orderedTabs(model).map((tab) => tab.id)).toEqual(["p2"]);
    const moved = tabsReducer(model, { type: "add-space", id: "s2" });
    expect(tabsReducer(moved, { type: "move-to-space", id: "p2", spaceId: "s2", now: 9 })).toBe(moved);
  });
});

describe("swipeTarget", () => {
  it("goes to neighbors, opens a new tab past the last one, stops before the first", () => {
    const model = run([open("t1"), open("t2"), { type: "activate", id: "t1", now: 5 }]);
    expect(swipeTarget(model, 1)).toEqual({ kind: "tab", id: "t2" });
    expect(swipeTarget(model, -1)).toBeNull();
    const last = tabsReducer(model, { type: "activate", id: "t2", now: 6 });
    expect(swipeTarget(last, 1)).toEqual({ kind: "new" });
    const start = run([open("t3", "")], last);
    expect(swipeTarget(start, 1)).toBeNull();
  });
});

describe("liveTabIds", () => {
  it("keeps the active tab and the most recently used ones", () => {
    const model = run([open("t1"), open("t2"), open("t3"), open("t4"), { type: "activate", id: "t2", now: 50 }]);
    expect(liveTabIds(model, 3)).toEqual(["t2", "t4", "t3"]);
  });

  it("never mounts start pages or never-activated background tabs", () => {
    const model = run([open("t1"), open("t2", undefined, { background: true }), open("t3", "")]);
    expect(liveTabIds(model, 4)).toEqual(["t1"]);
  });

  it("can keep every private tab alive", () => {
    const model = run([open("t1"), open("p1", undefined, { spaceId: PRIVATE_SPACE_ID }), open("p2", undefined, { spaceId: PRIVATE_SPACE_ID }), open("t5")]);
    expect(liveTabIds(model, 1, true).sort()).toEqual(["p1", "p2", "t5"]);
    expect(liveTabIds(model, 1, false)).toEqual(["t5"]);
  });
});

describe("session persistence", () => {
  it("round-trips without private tabs or transient state", () => {
    const model = run([open("t1"), { type: "pin", id: "t1", pinned: true }, open("p1", undefined, { spaceId: PRIVATE_SPACE_ID })]);
    const stored = serializeSession(model);
    expect(stored.tabs.map((tab) => tab.id)).toEqual(["t1"]);
    expect(stored.activeSpaceId).toBe(DEFAULT_SPACE.id);
    const restored = parseSession(JSON.parse(JSON.stringify(stored)));
    expect(restored?.tabs[0]).toMatchObject({ id: "t1", url: "https://t1.example/", isPinned: true, isLoading: false });
    expect(activeTab(restored!)?.id).toBe("t1");
  });

  it("drops invalid tabs and spaces", () => {
    const restored = parseSession({
      tabs: [
        { id: "a", url: "javascript:alert(1)" },
        { id: "b", url: "file:///etc/passwd" },
        { id: "c", url: "https://ok.example/", spaceId: "unknown" },
        { id: "c", url: "https://dup.example/" },
        { id: "../x", url: "https://bad-id.example/" },
        { id: "d", url: "" },
      ],
      spaces: [{ id: PRIVATE_SPACE_ID, name: "x" }, null, { id: "work", name: "Travail", icon: "💼" }],
      activeSpaceId: "nope",
    });
    expect(restored?.tabs.map((tab) => [tab.id, tab.spaceId])).toEqual([
      ["c", "work"],
      ["d", "work"],
    ]);
    expect(restored?.spaces.map((space) => space.id)).toEqual(["work"]);
    expect(restored?.activeSpaceId).toBe("work");
  });

  it("rejects non-sessions", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession({ tabs: "x", spaces: [] })).toBeNull();
  });
});
