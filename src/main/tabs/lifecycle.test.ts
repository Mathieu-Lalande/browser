import type { WebContentsView } from "electron";
import { describe, expect, it, vi } from "vitest";
import { TabLayout } from "./layout";
import { TabLifecycle } from "./lifecycle";
import { isDiscarded } from "./model";
import { TabStore } from "./store";

type Entry = { url: string };

/** A page view whose webContents keeps a back/forward list, like Chromium's. */
function fakeView() {
  const history = { entries: [] as Entry[], index: -1 };
  let destroyed = false;
  const contents = {
    isDestroyed: () => destroyed,
    close: vi.fn(() => {
      destroyed = true;
    }),
    getURL: () => history.entries[history.index]?.url ?? "",
    loadURL: vi.fn(async (url: string) => {
      history.entries = [...history.entries.slice(0, history.index + 1), { url }];
      history.index = history.entries.length - 1;
    }),
    isCurrentlyAudible: () => false,
    isDevToolsOpened: () => false,
    navigationHistory: {
      length: () => history.entries.length,
      getAllEntries: () => history.entries,
      getActiveIndex: () => history.index,
      canGoBack: () => history.index > 0,
      canGoForward: () => history.index < history.entries.length - 1,
      restore: vi.fn(async (saved: { entries: Entry[]; index: number }) => {
        history.entries = [...saved.entries];
        history.index = saved.index;
      }),
    },
  };
  return { webContents: contents, setBounds: vi.fn() } as unknown as WebContentsView & { webContents: typeof contents };
}

function setup() {
  let next = 0;
  const store = new TabStore(() => `t${next++}`);
  const window = { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } };
  const layout = new TabLayout(window, store, true);
  const views: ReturnType<typeof fakeView>[] = [];
  const deps = {
    store,
    layout,
    createView: () => {
      const view = fakeView();
      views.push(view);
      return view;
    },
    wire: vi.fn(),
    viewCreated: vi.fn(),
    applyZoom: vi.fn(),
    shieldsFor: () => true,
    emit: vi.fn(),
    measureMemory: vi.fn(() => 42_000),
  };
  const lifecycle = new TabLifecycle(deps);
  const add = (url: string) => store.insert({ url, title: "", favicon: null, pinned: false }, store.length, { shieldsEnabled: true, defaultZoom: 1 });
  return { store, layout, lifecycle, deps, views, window, add };
}

describe("TabLifecycle", () => {
  it("creates a page on first wake and wires it", () => {
    const { lifecycle, deps, views, add } = setup();
    const tab = add("https://a.example/");
    expect(isDiscarded(tab)).toBe(true);
    lifecycle.wake(tab);
    expect(views).toHaveLength(1);
    expect(deps.wire).toHaveBeenCalledWith(tab, views[0].webContents);
    expect(views[0].webContents.loadURL).toHaveBeenCalledWith("https://a.example/");
    expect(tab.waking).toBe("https://a.example/");
    // A tab with a page is not woken again.
    lifecycle.wake(tab);
    expect(views).toHaveLength(1);
  });

  it("puts a background tab to sleep and wakes it with its history", async () => {
    const { store, layout, lifecycle, views, add, deps } = setup();
    const tab = add("https://a.example/");
    const other = add("https://b.example/");
    store.setActive(tab.id);
    lifecycle.wake(tab);
    const contents = views[0].webContents;
    await contents.loadURL("https://a.example/next");
    tab.state.url = "https://a.example/next";
    layout.syncAttachment();

    // On screen: refused.
    expect(lifecycle.discard(tab)).toBe(false);
    store.setActive(other.id);
    layout.syncAttachment();
    expect(lifecycle.discard(tab)).toBe(true);
    expect(contents.close).toHaveBeenCalled();
    expect(tab.view).toBeNull();
    expect(isDiscarded(tab)).toBe(true);
    expect(tab.sleptHistory?.index).toBe(1);
    // "Mémoire libérée" (ADR-054): measured before the page closed.
    expect(deps.measureMemory).toHaveBeenCalledWith(contents);
    expect(tab.sleepFreedKb).toBe(42_000);

    store.setActive(tab.id);
    lifecycle.wake(tab);
    expect(tab.sleepFreedKb).toBeUndefined();
    const woken = views[1].webContents;
    expect(woken.navigationHistory.restore).toHaveBeenCalledWith({ entries: [{ url: "https://a.example/" }, { url: "https://a.example/next" }], index: 1 });
    expect(woken.loadURL).not.toHaveBeenCalled();
    expect(tab.sleptHistory).toBeUndefined();
  });

  it("reports sleep candidates and marks tabs on screen as seen", () => {
    const { store, lifecycle, add } = setup();
    const shown = add("https://a.example/");
    const hidden = add("https://b.example/");
    shown.lastSeenAt = hidden.lastSeenAt = 1;
    store.setActive(shown.id);
    const candidates = lifecycle.sleepCandidates(500);
    expect(candidates.map(({ id, shown, hasView, lastSeenAt }) => ({ id, shown, hasView, lastSeenAt }))).toEqual([
      { id: shown.id, shown: true, hasView: false, lastSeenAt: 500 },
      { id: hidden.id, shown: false, hasView: false, lastSeenAt: 1 },
    ]);
  });

  it("closes a page for another session", () => {
    const { lifecycle, views, add } = setup();
    const tab = add("https://a.example/");
    lifecycle.wake(tab);
    tab.state.canGoBack = true;
    lifecycle.closePage(tab);
    expect(views[0].webContents.close).toHaveBeenCalled();
    expect(tab.view).toBeNull();
    expect(tab.state.canGoBack).toBe(false);
  });
});
