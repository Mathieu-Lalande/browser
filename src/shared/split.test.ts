import { describe, expect, it } from "vitest";
import type { Bounds } from "./types";
import { MAX_SPLIT_TABS, ratioAt, splitLayout, splitWith, splitWithout } from "./split";

const area: Bounds = { x: 100, y: 50, width: 1008, height: 708 };

const overlaps = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (pane: Bounds) =>
  pane.x >= area.x && pane.y >= area.y && pane.x + pane.width <= area.x + area.width && pane.y + pane.height <= area.y + area.height;

describe("splitLayout", () => {
  it("fills the area with a single pane", () => {
    expect(splitLayout(area, 1)).toEqual({ panes: [area], dividers: [] });
  });

  it("splits two columns at the ratio, with the gap between them", () => {
    const { panes, dividers } = splitLayout(area, 2, 0.5, 0.5, 8);
    expect(panes).toEqual([
      { x: 100, y: 50, width: 500, height: 708 },
      { x: 608, y: 50, width: 500, height: 708 },
    ]);
    expect(dividers).toEqual([{ axis: "x", rect: { x: 600, y: 50, width: 8, height: 708 } }]);
    const [left, right] = splitLayout(area, 2, 0.25, 0.5, 8).panes;
    expect(left.width).toBe(250);
    expect(right.x + right.width).toBe(area.x + area.width);
  });

  it("lays out 3 panes as a full-height column plus a split column, and 4 as a grid", () => {
    const three = splitLayout(area, 3, 0.5, 0.5, 8);
    expect(three.panes).toEqual([
      { x: 100, y: 50, width: 500, height: 708 },
      { x: 608, y: 50, width: 500, height: 350 },
      { x: 608, y: 408, width: 500, height: 350 },
    ]);
    expect(three.dividers.map((d) => d.axis)).toEqual(["x", "y"]);
    expect(three.dividers[1].rect).toEqual({ x: 608, y: 400, width: 500, height: 8 });

    const four = splitLayout(area, 4, 0.5, 0.5, 8);
    expect(four.panes).toHaveLength(4);
    expect(four.dividers[1].rect).toEqual({ x: 100, y: 400, width: 1008, height: 8 });
  });

  it("never overlaps panes nor leaves the area, for any count and ratio", () => {
    for (const count of [2, 3, 4]) {
      for (const ratio of [-1, 0, 0.1, 0.33, 0.5, 0.77, 1, 2, Number.NaN]) {
        const { panes } = splitLayout(area, count, ratio, 1 - ratio);
        expect(panes).toHaveLength(count);
        for (const pane of panes) {
          expect(inside(pane)).toBe(true);
          expect(pane.width).toBeGreaterThan(0);
          expect(Number.isInteger(pane.x) && Number.isInteger(pane.width)).toBe(true);
        }
        for (let i = 0; i < panes.length; i++) for (let j = i + 1; j < panes.length; j++) expect(overlaps(panes[i], panes[j])).toBe(false);
      }
    }
  });

  it("clamps ratios so no pane gets too small", () => {
    const [left] = splitLayout(area, 2, 0.01, 0.5, 8).panes;
    expect(left.width).toBe(200);
  });
});

describe("ratioAt", () => {
  it("is the inverse of the layout for a pointer in the divider", () => {
    const { dividers } = splitLayout(area, 2, 0.4, 0.5, 8);
    const center = dividers[0].rect.x + 4;
    expect(ratioAt(center, area.x, area.width, 8)).toBeCloseTo(0.4, 2);
    expect(ratioAt(0, area.x, area.width, 8)).toBe(0.2);
  });
});

describe("split model", () => {
  it("opens a split with the active tab, then adds tabs up to the limit", () => {
    expect(splitWith(null, "a", "a")).toBeNull();
    expect(splitWith(null, null, "b")).toBeNull();
    let split = splitWith(null, "a", "b");
    expect(split).toEqual({ tabIds: ["a", "b"], ratioX: 0.5, ratioY: 0.5 });
    split = splitWith(split, "b", "c");
    expect(split?.tabIds).toEqual(["a", "b", "c"]);
    expect(splitWith(split, "b", "c")).toBeNull();
    split = splitWith(split, "a", "d");
    expect(split?.tabIds).toHaveLength(MAX_SPLIT_TABS);
    expect(splitWith(split, "a", "e")).toBeNull();
  });

  it("replaces the split when the active tab is not in it", () => {
    expect(splitWith({ tabIds: ["a", "b"], ratioX: 0.3, ratioY: 0.5 }, "c", "d")?.tabIds).toEqual(["c", "d"]);
  });

  it("removes tabs, and ends the split below two tabs", () => {
    const split = { tabIds: ["a", "b", "c"], ratioX: 0.3, ratioY: 0.5 };
    expect(splitWithout(split, "x")).toBe(split);
    expect(splitWithout(split, "b")).toEqual({ tabIds: ["a", "c"], ratioX: 0.3, ratioY: 0.5 });
    expect(splitWithout({ tabIds: ["a", "b"], ratioX: 0.5, ratioY: 0.5 }, "a")).toBeNull();
    expect(splitWithout(null, "a")).toBeNull();
  });
});
