import { describe, expect, it } from "vitest";
import { isMemoryLow, nextInCycle, predictNextTabs, prewarmBlocker, prewarmExpired, prewarmTarget, PREWARM_TTL_MS, type PrewarmConditions, type PrewarmTab } from "./tab-prewarm";

const tab = (id: string, extra: Partial<PrewarmTab> = {}): PrewarmTab => ({ id, sleeping: true, shown: false, pinned: false, lastActiveAt: 0, activations: 0, ...extra });
const ok: PrewarmConditions = { enabled: true, sleeping: true, energySaver: false, memory: { freeKb: 4_000_000, totalKb: 16_000_000 }, inFlight: 0 };

describe("smart preloading of sleeping tabs (ADR-057)", () => {
  it("is bounded: setting, sleeping on, energy saver, memory, one at a time", () => {
    expect(prewarmBlocker(ok)).toBeNull();
    expect(prewarmBlocker({ ...ok, enabled: false })).toBe("disabled");
    expect(prewarmBlocker({ ...ok, sleeping: false })).toBe("no-sleep");
    expect(prewarmBlocker({ ...ok, energySaver: true })).toBe("energy-saver");
    expect(prewarmBlocker({ ...ok, memory: { freeKb: 300_000, totalKb: 16_000_000 } })).toBe("low-memory");
    expect(prewarmBlocker({ ...ok, inFlight: 1 })).toBe("busy");
    expect(prewarmBlocker({ ...ok, memory: null })).toBeNull();
  });

  it("reads memory pressure from the free share and the absolute amount", () => {
    expect(isMemoryLow({ freeKb: 1_000_000, totalKb: 16_000_000 })).toBe(true);
    expect(isMemoryLow({ freeKb: 700_000, totalKb: 4_000_000 })).toBe(false);
    expect(isMemoryLow({ freeKb: 400_000, totalKb: 2_000_000 })).toBe(true);
    expect(isMemoryLow({ freeKb: 1, totalKb: 0 })).toBe(false);
  });

  it("finds the next stop of Ctrl+Tab in sidebar order, both ways, wrapping around", () => {
    expect(nextInCycle(["a", "b", "c"], "b", 1)).toBe("c");
    expect(nextInCycle(["a", "b", "c"], "c", 1)).toBe("a");
    expect(nextInCycle(["a", "b", "c"], "a", -1)).toBe("c");
    expect(nextInCycle(["a"], "a", 1)).toBeNull();
    expect(nextInCycle(["a", "b"], "z", 1)).toBeNull();
  });

  it("predicts the alternated tab first, then the neighbours, then pinned and frequent ones", () => {
    const tabs = [tab("a", { pinned: true }), tab("b"), tab("c", { lastActiveAt: 10 }), tab("d", { lastActiveAt: 50, shown: true }), tab("e"), tab("f", { activations: 9 })];
    // "d" is active; "c" was used before it (and is its upper neighbour), "e" is below it.
    expect(predictNextTabs(tabs, "d", 4)).toEqual(["c", "e", "a", "f"]);
    const alternate = [tab("a", { lastActiveAt: 90 }), tab("b"), tab("c", { shown: true, lastActiveAt: 100 }), tab("d")];
    expect(predictNextTabs(alternate, "c", 2)).toEqual(["a", "d"]);
    expect(predictNextTabs([tab("a")], "a")).toEqual([]);
  });

  it("only wakes a sleeping tab that is not on screen", () => {
    const tabs = [tab("a", { sleeping: false }), tab("b", { shown: true }), tab("c")];
    expect(prewarmTarget(tabs, ["a", "b", "c"])).toBe("c");
    expect(prewarmTarget(tabs, ["a", "b"])).toBeNull();
  });

  it("puts a tab woken for nothing back to sleep after a while", () => {
    expect(prewarmExpired(1000, 500, false, 1000 + PREWARM_TTL_MS)).toBe(true);
    expect(prewarmExpired(1000, 500, false, 1000 + PREWARM_TTL_MS - 1)).toBe(false);
    expect(prewarmExpired(1000, 2000, false, 1000 + PREWARM_TTL_MS)).toBe(false);
    expect(prewarmExpired(1000, 500, true, 1000 + PREWARM_TTL_MS)).toBe(false);
  });
});
