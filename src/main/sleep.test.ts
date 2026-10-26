import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { sleepBlocker, sleepCheckInterval, sleepTabNow, sleepTabs, tabsToSleep, type SleepCandidate, type SleepTarget } from "./sleep";

const NOW = 10_000_000;
const MINUTE = 60_000;

const tab = (overrides: Partial<SleepCandidate> = {}): SleepCandidate => ({
  id: "t",
  hasView: true,
  shown: false,
  audible: false,
  permissionPending: false,
  devTools: false,
  lastSeenAt: NOW - 45 * MINUTE,
  pinned: false,
  ...overrides,
});

const idle30 = { now: NOW, idleMs: 30 * MINUTE };

describe("sleepBlocker", () => {
  it("lets an idle background tab sleep", () => {
    expect(sleepBlocker(tab(), idle30)).toBeNull();
  });

  it("waits for the idle delay", () => {
    expect(sleepBlocker(tab({ lastSeenAt: NOW - 29 * MINUTE }), idle30)).toBe("recent");
    expect(sleepBlocker(tab({ lastSeenAt: NOW - 30 * MINUTE }), idle30)).toBeNull();
  });

  it("never unloads what is on screen, playing sound, asking for a permission or being inspected", () => {
    expect(sleepBlocker(tab({ shown: true }), idle30)).toBe("shown");
    expect(sleepBlocker(tab({ audible: true }), idle30)).toBe("audible");
    expect(sleepBlocker(tab({ permissionPending: true }), idle30)).toBe("permission");
    expect(sleepBlocker(tab({ devTools: true }), idle30)).toBe("devtools");
  });

  it("has nothing to do for tabs without a page (start page, already asleep, restored)", () => {
    expect(sleepBlocker(tab({ hasView: false }), idle30)).toBe("no-page");
  });

  it("lets pinned tabs sleep too (they keep their place)", () => {
    expect(sleepBlocker(tab({ pinned: true }), idle30)).toBeNull();
  });

  it("waives only the delay for manual requests", () => {
    const manual = { now: NOW, idleMs: null };
    expect(sleepBlocker(tab({ lastSeenAt: NOW }), manual)).toBeNull();
    expect(sleepBlocker(tab({ lastSeenAt: NOW, audible: true }), manual)).toBe("audible");
    expect(sleepBlocker(tab({ lastSeenAt: NOW, shown: true }), manual)).toBe("shown");
  });
});

describe("tabsToSleep", () => {
  it("keeps eligible tabs only, least recently seen first", () => {
    const tabs = [
      tab({ id: "a", lastSeenAt: NOW - 40 * MINUTE }),
      tab({ id: "shown", shown: true, lastSeenAt: 0 }),
      tab({ id: "b", lastSeenAt: NOW - 90 * MINUTE }),
      tab({ id: "fresh", lastSeenAt: NOW - MINUTE }),
      tab({ id: "music", audible: true }),
    ];
    expect(tabsToSleep(tabs, idle30)).toEqual(["b", "a"]);
  });
});

describe("sleepCheckInterval", () => {
  it("checks a few times per delay, within bounds", () => {
    expect(sleepCheckInterval(30 * MINUTE)).toBe(MINUTE);
    expect(sleepCheckInterval(2000)).toBe(500);
    expect(sleepCheckInterval(100)).toBe(250);
  });
});

/** A fake TabManager: `pages` maps tab ids to whether their page has unsaved input (or throws). */
function target(candidates: SleepCandidate[], pages: Record<string, boolean | "error" | "hang">) {
  const discarded: string[] = [];
  const page = (state: boolean | "error" | "hang") =>
    ({
      isDestroyed: () => false,
      executeJavaScriptInIsolatedWorld: vi.fn(() =>
        state === "error" ? Promise.reject(new Error("gone")) : state === "hang" ? new Promise(() => {}) : Promise.resolve(state),
      ),
    }) as unknown as WebContents;
  const fake: SleepTarget = {
    sleepCandidates: () => candidates.filter((candidate) => !discarded.includes(candidate.id)),
    pageOf: (id) => (id in pages ? page(pages[id]) : null),
    discard: (id) => (discarded.push(id), true),
    activateOther: (id) => {
      const current = candidates.find((candidate) => candidate.id === id);
      if (current) current.shown = false;
      return candidates.length > 1;
    },
  };
  return { fake, discarded };
}

describe("sleepTabs", () => {
  it("keeps tabs whose page has unsaved input, or does not answer", async () => {
    const { fake, discarded } = target(
      [tab({ id: "clean" }), tab({ id: "form" }), tab({ id: "broken" }), tab({ id: "shown", shown: true })],
      { clean: false, form: true, broken: "error", shown: false },
    );
    expect(await sleepTabs(fake, null, 30 * MINUTE)).toEqual(["clean"]);
    expect(discarded).toEqual(["clean"]);
  });

  it("gives up on pages that hang", async () => {
    vi.useFakeTimers();
    try {
      const { fake, discarded } = target([tab({ id: "hung" })], { hung: "hang" });
      const result = sleepTabs(fake, null, null);
      await vi.advanceTimersByTimeAsync(2_500);
      expect(await result).toEqual([]);
      expect(discarded).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can be limited to some tabs", async () => {
    const { fake } = target([tab({ id: "a" }), tab({ id: "b" })], { a: false, b: false });
    expect(await sleepTabs(fake, ["b"], null)).toEqual(["b"]);
  });
});

describe("sleepTabNow", () => {
  it("puts the tab on screen to sleep after showing another one", async () => {
    const { fake, discarded } = target([tab({ id: "active", shown: true, lastSeenAt: NOW }), tab({ id: "other" })], {
      active: false,
    });
    expect(await sleepTabNow(fake, "active")).toBe(true);
    expect(discarded).toEqual(["active"]);
  });

  it("refuses when the tab is the only one, plays sound, or has unsaved input", async () => {
    const alone = target([tab({ id: "only", shown: true })], { only: false });
    expect(await sleepTabNow(alone.fake, "only")).toBe(false);
    const music = target([tab({ id: "music", audible: true }), tab({ id: "x" })], { music: false });
    expect(await sleepTabNow(music.fake, "music")).toBe(false);
    const form = target([tab({ id: "form" }), tab({ id: "x" })], { form: true });
    expect(await sleepTabNow(form.fake, "form")).toBe(false);
    expect([...alone.discarded, ...music.discarded, ...form.discarded]).toEqual([]);
  });
});
