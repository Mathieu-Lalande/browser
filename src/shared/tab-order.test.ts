import { describe, expect, it } from "vitest";
import { closeSuccessor, pinnedFirst, tabSlot } from "./tab-order";

/** `p` = pinned, `u` = unpinned. */
const list = (pattern: string) => [...pattern].map((kind) => ({ pinned: kind === "p" }));

describe("tabSlot", () => {
  it("keeps an unpinned tab after the pinned ones", () => {
    expect(tabSlot(list("ppuu"), false, 0)).toBe(2);
    expect(tabSlot(list("ppuu"), false, 1)).toBe(2);
    expect(tabSlot(list("ppuu"), false, 3)).toBe(3);
    expect(tabSlot(list("ppuu"), false, 99)).toBe(4);
  });

  it("keeps a pinned tab among the pinned ones", () => {
    expect(tabSlot(list("ppuu"), true, 0)).toBe(0);
    expect(tabSlot(list("ppuu"), true, 2)).toBe(2);
    expect(tabSlot(list("ppuu"), true, 3)).toBe(2);
    expect(tabSlot(list("uu"), true, 1)).toBe(0);
  });

  it("moves across the boundary land on the boundary", () => {
    // "p u u u", moving the last unpinned tab (list without it: "p u u") to the front.
    expect(tabSlot(list("puu"), false, 0)).toBe(1);
    // Moving the pinned tab (list without it: "u u u") to the end.
    expect(tabSlot(list("uuu"), true, 3)).toBe(0);
  });

  it("clamps out-of-range and invalid indexes", () => {
    expect(tabSlot(list("pu"), false, -5)).toBe(1);
    expect(tabSlot(list("pu"), true, -5)).toBe(0);
    expect(tabSlot(list("pu"), false, Number.NaN)).toBe(2);
    expect(tabSlot([], false, 3)).toBe(0);
  });
});

describe("pinnedFirst", () => {
  it("puts pinned tabs first, keeping each group's order", () => {
    const tabs = [
      { id: "a", pinned: false },
      { id: "b", pinned: true },
      { id: "c", pinned: false },
      { id: "d", pinned: true },
    ];
    expect(pinnedFirst(tabs, (tab) => tab.pinned).map((tab) => tab.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("closeSuccessor", () => {
  // The closed tab was at index 1 of [a, X, b, c].
  const rest = ["a", "b", "c"];
  it("activates the next tab, or the previous one at the end", () => {
    expect(closeSuccessor(rest, 1, "next")).toBe("b");
    expect(closeSuccessor(rest, 3, "next")).toBe("c");
    expect(closeSuccessor([], 0, "next")).toBeUndefined();
  });
  it("activates the previous tab, or the next one at the start", () => {
    expect(closeSuccessor(rest, 1, "previous")).toBe("a");
    expect(closeSuccessor(rest, 0, "previous")).toBe("a");
  });
  it("activates the most recent tab, else falls back to the next one", () => {
    expect(closeSuccessor(rest, 1, "recent", () => "c")).toBe("c");
    expect(closeSuccessor(rest, 1, "recent", () => undefined)).toBe("b");
  });
});
