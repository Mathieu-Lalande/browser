import { describe, expect, it } from "vitest";
import { RecentStack, pickWindows, startupPlan, summarizeSession } from "./recovery";

const window = (...urls: string[]) => ({ spaces: [{ tabs: urls.map((url) => ({ url, title: url ? `T ${url}` : "" })) }] });

describe("startupPlan", () => {
  it("offers the session after a crash, whatever the setting", () => {
    expect(startupPlan({ unclean: true, restoreSession: true, savedWindows: 2 })).toBe("offer");
    expect(startupPlan({ unclean: true, restoreSession: false, savedWindows: 1 })).toBe("offer");
  });
  it("follows the setting after a clean quit", () => {
    expect(startupPlan({ unclean: false, restoreSession: true, savedWindows: 1 })).toBe("restore");
    expect(startupPlan({ unclean: false, restoreSession: false, savedWindows: 1 })).toBe("fresh");
  });
  it("has nothing to do without a saved window", () => {
    expect(startupPlan({ unclean: true, restoreSession: true, savedWindows: 0 })).toBe("fresh");
  });
});

describe("summarizeSession", () => {
  it("counts tabs per window and lists a few titles", () => {
    const summary = summarizeSession({ windows: [window("a", "b", "c", "d"), window(), window("")] });
    expect(summary).toEqual({
      tabCount: 5,
      windows: [
        { index: 0, tabCount: 4, titles: ["T a", "T b", "T c"] },
        { index: 2, tabCount: 1, titles: ["Nouvel onglet"] },
      ],
    });
  });
  it("is null when nothing is left", () => {
    expect(summarizeSession(null)).toBeNull();
    expect(summarizeSession({ windows: [window()] })).toBeNull();
  });
});

describe("pickWindows", () => {
  it("keeps valid, unique, sorted indexes", () => {
    expect(pickWindows(3, null)).toEqual([0, 1, 2]);
    expect(pickWindows(3, [2, 0, 2, 7, -1, 1.5])).toEqual([0, 2]);
  });
});

describe("RecentStack", () => {
  it("is bounded and takes from the most recent", () => {
    const stack = new RecentStack<number>(3);
    for (const n of [1, 2, 3, 4]) stack.push(n);
    expect(stack.list()).toEqual([4, 3, 2]);
    expect(stack.take(1)).toBe(3);
    expect(stack.take()).toBe(4);
    expect(stack.take(5)).toBeUndefined();
    expect(stack.size).toBe(1);
  });
});
