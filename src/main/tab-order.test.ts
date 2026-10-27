import { describe, expect, it } from "vitest";
import { tabSlot } from "./tab-order";

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
