import { describe, expect, it, vi } from "vitest";
import { sidebarRows, type TabFolder } from "@shared/folders";
import { autoScrollStep, dropFromBoxes, indicatorIndent, overBox, passedThreshold, splitTargetFromBoxes, TreeDrag } from "./tree-drag.svelte";

const folders: TabFolder[] = [{ id: "f", name: "Dossier", icon: "folder", parentId: null, collapsed: false }];
const rows = sidebarRows(
  [
    { id: "a", pinned: false, folderId: "f" },
    { id: "b", pinned: false, folderId: null },
    { id: "c", pinned: false, folderId: null },
  ],
  folders,
);
// Rows: folder f (0), a in f (1), b (2), c (3); 30px each from y = 100.
const boxes = rows.map((_, index) => ({ index, top: 100 + index * 30, bottom: 130 + index * 30 }));

describe("tree drag helpers", () => {
  it("starts a drag past the threshold only", () => {
    expect(passedThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
    expect(passedThreshold({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
  });

  it("counts a little vertical slack around the favorites grid", () => {
    const box = { top: 10, bottom: 50, left: 0, right: 100 };
    expect(overBox(box, 50, 7)).toBe(true);
    expect(overBox(box, 50, 55)).toBe(false);
    expect(overBox(box, 101, 30)).toBe(false);
  });

  it("scrolls the list near its edges", () => {
    const list = { top: 0, bottom: 300 };
    expect(autoScrollStep(list, 10)).toBe(-8);
    expect(autoScrollStep(list, 150)).toBe(0);
    expect(autoScrollStep(list, 290)).toBe(8);
  });

  it("drops a tab into the folder under the pointer", () => {
    const drop = dropFromBoxes(rows, folders, { kind: "tab", id: "c" }, boxes, 115);
    expect(drop).toMatchObject({ kind: "tab", folderId: "f", indicator: { row: 0, edge: "inside" } });
  });

  it("drops a tab before or after a row by the pointer's half", () => {
    expect(dropFromBoxes(rows, folders, { kind: "tab", id: "c" }, boxes, 162)).toMatchObject({ kind: "tab", beforeId: "b" });
    expect(dropFromBoxes(rows, folders, { kind: "tab", id: "a" }, boxes, 182)).toMatchObject({ kind: "tab", beforeId: "c" });
  });

  it("splits with a tab when dropped on the middle of its row, never on its own row or a folder (ADR-045)", () => {
    // Row b spans 160…190: its middle half (167.5…182.5) splits, its quarters still reorder.
    expect(splitTargetFromBoxes(rows, { kind: "tab", id: "c" }, boxes, 175)).toEqual({ id: "b", row: 2 });
    expect(splitTargetFromBoxes(rows, { kind: "tab", id: "c" }, boxes, 162)).toBeNull();
    expect(splitTargetFromBoxes(rows, { kind: "tab", id: "c" }, boxes, 188)).toBeNull();
    expect(splitTargetFromBoxes(rows, { kind: "tab", id: "b" }, boxes, 175)).toBeNull();
    expect(splitTargetFromBoxes(rows, { kind: "tab", id: "c" }, boxes, 115)).toBeNull();
    expect(splitTargetFromBoxes(rows, { kind: "folder", id: "f" }, boxes, 175)).toBeNull();
  });

  it("drops past the last row at the end, and just above the first one before it", () => {
    expect(dropFromBoxes(rows, folders, { kind: "tab", id: "b" }, boxes, 400)).toMatchObject({ kind: "tab", folderId: null, beforeId: null });
    expect(dropFromBoxes(rows, folders, { kind: "folder", id: "f" }, boxes, 90)).not.toBeUndefined();
    expect(dropFromBoxes(rows, folders, { kind: "tab", id: "b" }, boxes, 50)).toBeNull();
  });

  it("indents the line one level for a folder dropped at the end of an open folder", () => {
    const nested: TabFolder[] = [...folders, { id: "g", name: "Autre", icon: "folder", parentId: null, collapsed: false }];
    const tree = sidebarRows([{ id: "a", pinned: false, folderId: "f" }], nested);
    expect(indicatorIndent(tree, { kind: "folder", parentId: "f", index: 0, indicator: { row: 0, edge: "after" } })).toBe(1);
    expect(indicatorIndent(tree, { kind: "folder", parentId: null, index: 0, indicator: { row: 0, edge: "after" } })).toBe(0);
    expect(indicatorIndent(tree, { kind: "tab", folderId: null, beforeId: null, indicator: { row: 0, edge: "after" } })).toBe(0);
  });
});

describe("TreeDrag", () => {
  const drag = () => new TreeDrag({ rows: () => rows, folders: () => folders, canFavorite: (item) => item.id === "b", onDrop: () => {} });

  it("is idle until a drag starts", () => {
    const tree = drag();
    expect(tree.current).toBeNull();
    expect(tree.canFavorite).toBe(false);
    expect(tree.insideRow).toBe(-1);
    expect(tree.indicator()).toBeNull();
    expect(tree.isDragged("tab", "b")).toBe(false);
  });

  it("knows the dragged item and whether it can become a favorite", () => {
    const tree = drag();
    tree.current = { item: { kind: "tab", id: "b" }, label: "B", x: 0, y: 0 };
    expect(tree.isDragged("tab", "b")).toBe(true);
    expect(tree.isDragged("folder", "b")).toBe(false);
    expect(tree.canFavorite).toBe(true);
    tree.drop = { kind: "tab", folderId: "f", beforeId: null, indicator: { row: 0, edge: "inside" } };
    expect(tree.insideRow).toBe(0);
  });

  it("swallows the one click that ends a gesture", () => {
    vi.useFakeTimers();
    const tree = drag();
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent;
    expect(tree.consumeClick(event)).toBe(false);
    tree.swallowNextClick();
    expect(tree.swallowing).toBe(true);
    expect(tree.consumeClick(event)).toBe(true);
    expect(tree.consumeClick(event)).toBe(false);
    tree.swallowNextClick();
    vi.runAllTimers();
    expect(tree.swallowing).toBe(false);
    vi.useRealTimers();
  });
});
