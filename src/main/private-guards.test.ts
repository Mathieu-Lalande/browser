import { describe, expect, it, vi } from "vitest";
import { PermissionStore } from "./privacy/permission-store";
import { persistentWindows, sessionOnClose, tabHooksFor } from "./private-guards";
import type { TabManagerHooks } from "./tabs";

const win = (name: string, isPrivate = false) => ({ name, isPrivate });

describe("private windows never persist", () => {
  it("record no history: visits and page titles/favicons are not passed on", () => {
    const hooks: TabManagerHooks = { onVisit: vi.fn(), onPageInfo: vi.fn(), isBookmarked: vi.fn(() => true), pageReady: vi.fn(), hasPasswords: vi.fn(() => true), peekLink: vi.fn() };
    const hooksForPrivate = tabHooksFor(hooks, true);
    // The link peek works in private windows (it records nothing itself, ADR-027).
    expect(hooksForPrivate.peekLink).toBe(hooks.peekLink);
    expect(hooksForPrivate.onVisit).toBeUndefined();
    expect(hooksForPrivate.onPageInfo).toBeUndefined();
    // Login forms are not watched (no save prompt), saved passwords can still be filled.
    expect(hooksForPrivate.pageReady).toBeUndefined();
    expect(hooksForPrivate.hasPasswords?.("https://example.com/")).toBe(true);
    // The bookmark star still shows.
    expect(hooksForPrivate.isBookmarked?.("https://example.com/")).toBe(true);
    // Normal windows keep everything.
    expect(tabHooksFor(hooks, false)).toBe(hooks);
  });

  it("are left out of session.json", () => {
    const windows = [win("a"), win("p", true), win("b")];
    expect(persistentWindows(windows).map((w) => w.name)).toEqual(["a", "b"]);
    expect(persistentWindows([win("p", true)])).toEqual([]);
  });

  it("never decide what happens to the saved session when they close", () => {
    const normal = win("normal");
    const priv = win("private", true);
    expect(sessionOnClose(priv, [normal, priv])).toBe("ignore");
    expect(sessionOnClose(priv, [priv])).toBe("ignore");
    // The last normal window is kept even if private windows remain open.
    expect(sessionOnClose(normal, [normal, priv])).toBe("keep");
    expect(sessionOnClose(normal, [normal, win("other")])).toBe("forget");
  });

  it("keep permission decisions in memory only, for the window's lifetime", async () => {
    const store = new PermissionStore(null);
    await store.set("https://meet.example", "camera", "allow", true);
    expect(store.get("https://meet.example", "camera")).toBe("allow");
    // A new store (another private window, or after a restart) knows nothing about it.
    expect(new PermissionStore(null).get("https://meet.example", "camera")).toBeUndefined();
  });
});
