import { describe, expect, it } from "vitest";
import type { SessionTab } from "../storage/session";
import { TabStore } from "./store";

const defaults = { shieldsEnabled: true, defaultZoom: 1.1 };
const entry = (url: string, pinned = false): SessionTab => ({ url, title: "", favicon: null, pinned });

function storeWith(...urls: string[]): TabStore {
  let next = 0;
  const store = new TabStore(() => `t${next++}`);
  for (const url of urls) store.insert(entry(url), store.length, defaults);
  return store;
}

describe("TabStore", () => {
  it("creates tab records from saved entries", () => {
    const store = storeWith("https://a.example/");
    const [tab] = store.all;
    expect(tab.id).toBe("t0");
    expect(tab.view).toBeNull();
    expect(tab.state).toMatchObject({ url: "https://a.example/", title: "a.example", zoom: 110, shieldsEnabled: true, folderId: null });
    expect(store.insert(entry(""), 9, defaults).state.title).toBe("Page d'accueil");
  });

  it("keeps pinned tabs before the others", () => {
    const store = storeWith("https://a.example/", "https://b.example/");
    const pinned = store.insert(entry("https://p.example/", true), 5, defaults);
    expect(store.indexOf(pinned.id)).toBe(0);
    expect(store.move("t0", 0)).toBe(true);
    expect(store.all.map((tab) => tab.id)).toEqual([pinned.id, "t0", "t1"]);
    pinned.state.isPinned = false;
    store.repin(pinned);
    expect(store.all.map((tab) => tab.id)).toEqual([pinned.id, "t0", "t1"]);
  });

  it("picks the tab after a closed active tab, or the last used one", () => {
    const store = storeWith("https://a.example/", "https://b.example/", "https://c.example/");
    store.setActive("t2");
    store.setActive("t0");
    store.setActive("t1");
    const { index } = store.take("t1")!;
    expect(store.closeSuccessor(index, "next")?.id).toBe("t2");
    expect(store.closeSuccessor(index, "previous")?.id).toBe("t0");
    expect(store.closeSuccessor(index, "recent")?.id).toBe("t0");
    // The last tab of the list: the one before it.
    const last = store.take("t2")!;
    expect(store.closeSuccessor(last.index, "next")?.id).toBe("t0");
  });

  it("finds another tab to activate, most recently used first", () => {
    const store = storeWith("https://a.example/", "https://b.example/", "https://c.example/");
    store.setActive("t1");
    store.setActive("t2");
    expect(store.otherThan("t2")).toBe("t1");
    expect(storeWith("https://a.example/", "https://b.example/").otherThan("t0")).toBe("t1");
  });

  it("places new tabs at the end or after the active one", () => {
    const store = storeWith("https://a.example/", "https://b.example/");
    expect(store.newTabIndex("end")).toBe(2);
    store.setActive("t0");
    expect(store.newTabIndex("next")).toBe(1);
  });

  it("remembers a bounded list of closed tabs", () => {
    const store = new TabStore();
    store.rememberClosed("", 0);
    expect(store.canReopenClosed).toBe(false);
    for (let i = 0; i < 30; i++) store.rememberClosed(`https://${i}.example/`, i);
    expect(store.popClosed()).toEqual({ url: "https://29.example/", index: 29 });
    let count = 1;
    while (store.popClosed()) count++;
    expect(count).toBe(25);
  });

  it("snapshots tabs, those on screen as seen now", () => {
    const store = storeWith("https://a.example/", "https://b.example/");
    store.all[0].lastSeenAt = 5;
    store.all[1].lastSeenAt = 7;
    store.all[1].state.folderId = "f";
    const saved = store.snapshot((tab) => tab.id === "t0", 100);
    expect(saved).toEqual([
      { url: "https://a.example/", title: "a.example", favicon: null, pinned: false, lastSeenAt: 100 },
      { url: "https://b.example/", title: "b.example", favicon: null, pinned: false, folderId: "f", lastSeenAt: 7 },
    ]);
  });
});
