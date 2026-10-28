import { describe, expect, it } from "vitest";
import {
  MAX_FOLDER_DEPTH,
  addFolder,
  dropZone,
  folderDepth,
  moveFolder,
  nextFolderName,
  placeTab,
  removeFolder,
  resolveDrop,
  sanitizeFolders,
  sidebarRows,
  updateFolder,
  visualOrder,
  type FolderedTab,
  type TabFolder,
} from "./folders";

const folder = (id: string, parentId: string | null = null, extra: Partial<TabFolder> = {}): TabFolder => ({
  id,
  name: id,
  icon: "folder",
  parentId,
  collapsed: false,
  ...extra,
});
const tab = (id: string, folderId: string | null = null, pinned = false): FolderedTab => ({ id, folderId, pinned });
const ids = (tabs: readonly FolderedTab[]) => tabs.map((t) => t.id);

describe("folder model", () => {
  it("adds folders with default names, refusing unknown parents and too deep nesting", () => {
    let folders = addFolder([], "a", null)!;
    expect(folders[0]).toEqual({ id: "a", name: "Nouveau dossier", icon: "folder", parentId: null, collapsed: false });
    folders = addFolder(folders, "b", "a", { name: "  Lecture \n", icon: "book-open" })!;
    expect(folders[1]).toMatchObject({ name: "Lecture", icon: "book-open", parentId: "a" });
    expect(nextFolderName(folders)).toBe("Nouveau dossier 2");
    expect(addFolder(folders, "c", "missing")).toBeNull();
    expect(addFolder(folders, "a", null)).toBeNull();
    let deep: TabFolder[] = [];
    let parent: string | null = null;
    for (let level = 1; level <= MAX_FOLDER_DEPTH; level++) {
      deep = addFolder(deep, `l${level}`, parent)!;
      parent = `l${level}`;
    }
    expect(folderDepth(deep, parent)).toBe(MAX_FOLDER_DEPTH);
    expect(addFolder(deep, "too-deep", parent)).toBeNull();
  });

  it("renames, changes the icon, collapses; empty names and unknown icons are ignored", () => {
    const folders = [folder("a")];
    expect(updateFolder(folders, "a", { name: "Travail", icon: "briefcase", collapsed: true })[0]).toMatchObject({
      name: "Travail",
      icon: "briefcase",
      collapsed: true,
    });
    expect(updateFolder(folders, "a", { name: "   " })[0].name).toBe("a");
    expect(updateFolder(folders, "a", { icon: "venetian-mask" as never })[0].icon).toBe("folder");
  });

  it("removes a folder with its sub-folders", () => {
    const { folders, removed } = removeFolder([folder("a"), folder("b", "a"), folder("c", "b"), folder("d")], "a");
    expect(folders.map((f) => f.id)).toEqual(["d"]);
    expect([...removed].sort()).toEqual(["a", "b", "c"]);
  });

  it("moves folders among siblings and into others, never into themselves", () => {
    const folders = [folder("a"), folder("b"), folder("c"), folder("x", "a")];
    expect(moveFolder(folders, "c", null, 0).map((f) => f.id)).toEqual(["c", "a", "b", "x"]);
    expect(moveFolder(folders, "b", "a", 0).find((f) => f.id === "b")!.parentId).toBe("a");
    expect(moveFolder(folders, "a", "x", 0)).toEqual(folders);
    expect(moveFolder(folders, "a", "a", 0)).toEqual(folders);
  });

  it("sanitizes stored folders: bad entries, unknown parents and cycles", () => {
    const stored = [
      { id: "a", name: "A", icon: "nope", parentId: "b" },
      { id: "b", name: "", parentId: "a", collapsed: true },
      { id: "a", name: "dup" },
      { id: "c", parentId: "ghost" },
      { id: "bad id!" },
      "junk",
    ];
    const folders = sanitizeFolders(stored);
    expect(folders.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(folders[0]).toMatchObject({ icon: "folder" });
    expect(folders[1]).toMatchObject({ name: "Nouveau dossier", collapsed: true });
    expect(folders.find((f) => f.id === "c")!.parentId).toBeNull();
    // The cycle a ⇄ b is broken.
    expect(folders.some((f) => f.parentId === null && (f.id === "a" || f.id === "b"))).toBe(true);
    expect(sanitizeFolders("nope")).toEqual([]);
  });
});

describe("tabs in folders", () => {
  const folders = [folder("f"), folder("g", "f")];

  it("orders tabs as shown: pinned, then each container's sub-folders before its tabs", () => {
    const tabs = [tab("r1"), tab("in-f", "f"), tab("p", null, true), tab("in-g", "g"), tab("r2"), tab("lost", "ghost")];
    expect(ids(visualOrder(tabs, folders))).toEqual(["p", "in-g", "in-f", "r1", "r2", "lost"]);
  });

  it("places a tab into a folder, before a sibling or at the end", () => {
    const tabs = visualOrder([tab("a"), tab("b"), tab("c", "f")], folders);
    expect(placeTab(tabs, folders, "a", "f", null).map((t) => [t.id, t.folderId])).toEqual([
      ["c", "f"],
      ["a", "f"],
      ["b", null],
    ]);
    expect(ids(placeTab(tabs, folders, "a", "f", "c"))).toEqual(["a", "c", "b"]);
    expect(ids(placeTab(tabs, folders, "b", null, "a"))).toEqual(["c", "b", "a"]);
    // Out of a folder, back to the root.
    expect(placeTab(tabs, folders, "c", null, null).at(-1)).toEqual(tab("c"));
  });

  it("never files pinned tabs nor into unknown folders", () => {
    const tabs = [tab("p", null, true), tab("a")];
    expect(placeTab(tabs, folders, "p", "f", null)).toEqual(tabs);
    expect(placeTab(tabs, folders, "a", "ghost", null)).toEqual(tabs);
  });

  it("lists sidebar rows; a collapsed folder only keeps the active tab visible", () => {
    const tabs = [tab("p", null, true), tab("x", "g"), tab("y", "f"), tab("z")];
    const label = (row: ReturnType<typeof sidebarRows>[number]) => (row.kind === "folder" ? `${row.folder.id}:${row.count}:${row.depth}` : `${row.id}@${row.depth}`);
    expect(sidebarRows(tabs, folders).map(label)).toEqual(["f:2:0", "g:1:1", "x@2", "y@1", "z@0"]);
    const collapsed = [folder("f", null, { collapsed: true }), folder("g", "f")];
    expect(sidebarRows(tabs, collapsed, "x").map((row) => (row.kind === "folder" ? row.folder.id : row.id))).toEqual(["f", "x", "z"]);
  });
});

describe("drag and drop", () => {
  const folders = [folder("f"), folder("g")];
  const tabs = [tab("a", "f"), tab("b", "f"), tab("c"), tab("d")];
  // Rows: f, a, b, g, c, d.
  const rows = sidebarRows(tabs, folders);
  const row = (id: string) => rows.findIndex((r) => (r.kind === "folder" ? r.folder.id : r.id) === id);

  it("splits rows into zones: tabs before/after, folders also inside (always inside for a tab)", () => {
    expect(dropZone(rows[row("c")], 0.2, "tab")).toBe("before");
    expect(dropZone(rows[row("c")], 0.8, "tab")).toBe("after");
    expect(dropZone(rows[row("f")], 0.1, "tab")).toBe("inside");
    expect(dropZone(rows[row("f")], 0.1, "folder")).toBe("before");
    expect(dropZone(rows[row("f")], 0.5, "folder")).toBe("inside");
    expect(dropZone(rows[row("f")], 0.9, "folder")).toBe("after");
  });

  it("drops a tab before/after a tab, into a folder, or at the end of the root", () => {
    expect(resolveDrop(rows, folders, { kind: "tab", id: "d" }, row("a"), "before")).toMatchObject({
      folderId: "f",
      beforeId: "a",
      indicator: { row: row("a"), edge: "before" },
    });
    expect(resolveDrop(rows, folders, { kind: "tab", id: "d" }, row("b"), "after")).toMatchObject({ folderId: "f", beforeId: null });
    expect(resolveDrop(rows, folders, { kind: "tab", id: "a" }, row("c"), "after")).toMatchObject({ folderId: null, beforeId: "d" });
    expect(resolveDrop(rows, folders, { kind: "tab", id: "c" }, row("g"), "inside")).toMatchObject({ folderId: "g", indicator: { edge: "inside" } });
    expect(resolveDrop(rows, folders, { kind: "tab", id: "a" }, rows.length, "after")).toMatchObject({ folderId: null, beforeId: null });
  });

  it("ignores drops that change nothing", () => {
    expect(resolveDrop(rows, folders, { kind: "tab", id: "c" }, row("c"), "after")).toBeNull();
    expect(resolveDrop(rows, folders, { kind: "tab", id: "d" }, row("c"), "after")).toBeNull();
  });

  it("drops folders among folders, into folders, never into themselves", () => {
    expect(resolveDrop(rows, folders, { kind: "folder", id: "g" }, row("f"), "before")).toMatchObject({ parentId: null, index: 0 });
    expect(resolveDrop(rows, folders, { kind: "folder", id: "g" }, row("f"), "inside")).toMatchObject({ parentId: "f", index: 0 });
    // After an open folder: first inside it.
    expect(resolveDrop(rows, folders, { kind: "folder", id: "g" }, row("f"), "after")).toMatchObject({ parentId: "f", index: 0, indicator: { edge: "after" } });
    expect(resolveDrop(rows, folders, { kind: "folder", id: "f" }, row("a"), "before")).toBeNull();
    expect(resolveDrop(rows, folders, { kind: "folder", id: "f" }, row("f"), "inside")).toBeNull();
    // Over a root tab: after the root's folders, the line above the first root tab.
    expect(resolveDrop(rows, folders, { kind: "folder", id: "f" }, row("d"), "after")).toMatchObject({
      parentId: null,
      index: 1,
      indicator: { row: row("c"), edge: "before" },
    });
  });
});
