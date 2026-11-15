import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREWARM_SETTLE_MS, PREWARM_TTL_MS } from "@shared/tab-prewarm";
import { PrewarmService, type PrewarmTarget } from "./tab-prewarm";

/** A tab list with sleeping tabs, waking one creates a fake page. */
function target(ids: string[], active: string) {
  const asleep = new Set(ids.filter((id) => id !== active));
  const pages = new Map<string, EventEmitter & { isDestroyed(): boolean; executeJavaScriptInIsolatedWorld(): Promise<boolean> }>();
  const discarded: string[] = [];
  const t: PrewarmTarget & { active: string } = {
    active,
    get activeTabId() {
      return this.active;
    },
    prewarmTabs: () => ids.map((id) => ({ id, sleeping: asleep.has(id), shown: id === t.active, pinned: false, lastActiveAt: 0 })),
    prewarm: (id) => {
      if (!asleep.has(id)) return null;
      asleep.delete(id);
      const page = Object.assign(new EventEmitter(), { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: async () => false });
      pages.set(id, page);
      return page as never;
    },
    sleepCandidates: () =>
      ids.map((id) => ({ id, hasView: !asleep.has(id), shown: id === t.active, audible: false, permissionPending: false, devTools: false, lastSeenAt: 0, pinned: false })),
    pageOf: (id) => (pages.get(id) as never) ?? null,
    discard: (id) => {
      discarded.push(id);
      asleep.add(id);
      return true;
    },
    activateOther: () => false,
  };
  return { t, pages, discarded };
}

describe("PrewarmService (ADR-057)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const service = (overrides: Partial<ConstructorParameters<typeof PrewarmService>[0]> = {}) =>
    new PrewarmService({ enabled: () => true, sleeping: () => true, energySaver: () => false, memory: () => null, ...overrides });

  it("wakes a hovered sleeping tab, one at a time until its page stops loading", () => {
    const prewarm = service();
    const { t, pages } = target(["a", "b", "c"], "a");
    expect(prewarm.hovered(t, "b")).toBe("b");
    expect(prewarm.hovered(t, "c")).toBeNull();
    pages.get("b")!.emit("did-stop-loading");
    expect(prewarm.hovered(t, "c")).toBe("c");
  });

  it("wakes the next stop of Ctrl+Tab, and the predicted tab once the user settles", () => {
    const prewarm = service();
    const { t } = target(["a", "b", "c"], "b");
    expect(prewarm.cycled(t, 1)).toBe("c");
    const other = target(["a", "b", "c"], "a");
    prewarm.dispose();
    const fresh = service();
    fresh.activated(other.t, "a");
    vi.advanceTimersByTime(PREWARM_SETTLE_MS);
    expect(other.pages.has("b")).toBe(true);
  });

  it("does nothing while saving energy or when turned off", () => {
    const { t } = target(["a", "b"], "a");
    expect(service({ energySaver: () => true }).hovered(t, "b")).toBeNull();
    expect(service({ enabled: () => false }).hovered(t, "b")).toBeNull();
    expect(service({ memory: () => ({ freeKb: 100_000, totalKb: 8_000_000 }) }).hovered(t, "b")).toBeNull();
  });

  it("puts a tab woken for nothing back to sleep", async () => {
    const prewarm = service();
    const { t, discarded } = target(["a", "b"], "a");
    prewarm.hovered(t, "b");
    await vi.advanceTimersByTimeAsync(PREWARM_TTL_MS + 10);
    expect(discarded).toEqual(["b"]);
  });

  it("keeps a woken tab that was shown", async () => {
    const prewarm = service();
    const { t, discarded } = target(["a", "b"], "a");
    prewarm.hovered(t, "b");
    t.active = "b";
    prewarm.activated(t, "b");
    await vi.advanceTimersByTimeAsync(PREWARM_TTL_MS + 10);
    expect(discarded).toEqual([]);
  });
});
