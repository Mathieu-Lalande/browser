import { isSpaceIcon, type SpaceIcon } from "./spaces";

/**
 * Tab folders of the sidebar (ADR-022): nested, per space, holding tabs. Pure (no Electron, no
 * DOM): main applies these functions to its TabManager, the chrome UI uses them to draw the tree
 * and to work out where a dragged row lands.
 *
 * Display rule (as in Arc): inside every container (the space root or a folder), its sub-folders
 * come first, then its tabs. Tabs keep their relative order from the flat tab list, which main
 * keeps sorted in this visual order (`visualOrder`) so that Ctrl+Tab follows what is on screen.
 */

export type FolderId = string;

export interface TabFolder {
  id: FolderId;
  name: string;
  /** A Lucide icon name from `SPACE_ICONS` ("folder" by default). */
  icon: SpaceIcon;
  /** Parent folder, or null at the root of the space. */
  parentId: FolderId | null;
  collapsed: boolean;
}

/** Fields the chrome UI may set on a folder. */
export interface FolderInput {
  name?: string;
  icon?: SpaceIcon;
  collapsed?: boolean;
}

export const DEFAULT_FOLDER_ICON: SpaceIcon = "folder";
export const DEFAULT_FOLDER_NAME = "Nouveau dossier";
export const MAX_FOLDERS = 64;
/** Nesting levels (a root folder is level 1). */
export const MAX_FOLDER_DEPTH = 4;
const MAX_NAME = 40;

export const isFolderId = (value: unknown): value is FolderId => typeof value === "string" && /^[\w-]{1,64}$/.test(value);

const cleanName = (name: string) => name.replace(/[\p{Cc}\s]+/gu, " ").trim().slice(0, MAX_NAME);

/** Whether a value is acceptable folder input from the UI (unknown fields are refused). */
export function isFolderInput(value: unknown): value is FolderInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const known = new Set(["name", "icon", "collapsed"]);
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).every((key) => known.has(key)) &&
    (v.name === undefined || (typeof v.name === "string" && v.name.length <= 256)) &&
    (v.icon === undefined || isSpaceIcon(v.icon)) &&
    (v.collapsed === undefined || typeof v.collapsed === "boolean")
  );
}

/** Ids of a folder and of every folder below it. */
export function subtree(folders: readonly TabFolder[], id: FolderId): Set<FolderId> {
  const ids = new Set<FolderId>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Level of a folder: 1 at the root (0 for an unknown id). */
export function folderDepth(folders: readonly TabFolder[], id: FolderId | null): number {
  let depth = 0;
  const seen = new Set<FolderId>();
  let current = id ? folders.find((folder) => folder.id === id) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    depth++;
    const parentId = current.parentId;
    current = parentId ? folders.find((folder) => folder.id === parentId) : undefined;
  }
  return depth;
}

/** Levels below a folder, itself included (1 for a folder without sub-folders). */
function subtreeHeight(folders: readonly TabFolder[], id: FolderId): number {
  const children = folders.filter((folder) => folder.parentId === id);
  return 1 + Math.max(0, ...children.map((child) => subtreeHeight(folders, child.id)));
}

/**
 * Validates stored folders: duplicates dropped, unknown parents, cycles and too deep nesting
 * moved to the root, at most MAX_FOLDERS.
 */
export function sanitizeFolders(value: unknown): TabFolder[] {
  if (!Array.isArray(value)) return [];
  const folders: TabFolder[] = [];
  for (const item of value) {
    if (folders.length >= MAX_FOLDERS) break;
    if (typeof item !== "object" || item === null) continue;
    const f = item as Record<string, unknown>;
    if (!isFolderId(f.id) || folders.some((folder) => folder.id === f.id)) continue;
    folders.push({
      id: f.id,
      name: (typeof f.name === "string" ? cleanName(f.name) : "") || DEFAULT_FOLDER_NAME,
      icon: isSpaceIcon(f.icon) ? f.icon : DEFAULT_FOLDER_ICON,
      parentId: isFolderId(f.parentId) ? f.parentId : null,
      collapsed: f.collapsed === true,
    });
  }
  const ids = new Set(folders.map((folder) => folder.id));
  for (const folder of folders) if (folder.parentId && (!ids.has(folder.parentId) || folder.parentId === folder.id)) folder.parentId = null;
  // Cycles: a folder that is its own ancestor goes to the root.
  for (const folder of folders) {
    const seen = new Set<FolderId>([folder.id]);
    let parent = folder.parentId;
    while (parent) {
      if (seen.has(parent)) {
        folder.parentId = null;
        break;
      }
      seen.add(parent);
      parent = folders.find((candidate) => candidate.id === parent)?.parentId ?? null;
    }
  }
  for (const folder of folders) if (folderDepth(folders, folder.id) > MAX_FOLDER_DEPTH) folder.parentId = null;
  return folders;
}

/** "Nouveau dossier", then "Nouveau dossier 2"… */
export function nextFolderName(folders: readonly TabFolder[]): string {
  const names = new Set(folders.map((folder) => folder.name));
  if (!names.has(DEFAULT_FOLDER_NAME)) return DEFAULT_FOLDER_NAME;
  let n = 2;
  while (names.has(`${DEFAULT_FOLDER_NAME} ${n}`)) n++;
  return `${DEFAULT_FOLDER_NAME} ${n}`;
}

/** Adds a folder at the end of its parent; null at the limit, for an unknown parent or too deep. */
export function addFolder(folders: readonly TabFolder[], id: FolderId, parentId: FolderId | null, input: FolderInput = {}): TabFolder[] | null {
  if (!isFolderId(id) || folders.length >= MAX_FOLDERS || folders.some((folder) => folder.id === id)) return null;
  if (parentId && !folders.some((folder) => folder.id === parentId)) return null;
  if (folderDepth(folders, parentId) + 1 > MAX_FOLDER_DEPTH) return null;
  const folder: TabFolder = {
    id,
    name: (input.name !== undefined ? cleanName(input.name) : "") || nextFolderName(folders),
    icon: input.icon && isSpaceIcon(input.icon) ? input.icon : DEFAULT_FOLDER_ICON,
    parentId,
    collapsed: input.collapsed === true,
  };
  return [...folders, folder];
}

export function updateFolder(folders: readonly TabFolder[], id: FolderId, input: FolderInput): TabFolder[] {
  return folders.map((folder) => {
    if (folder.id !== id) return folder;
    const name = input.name !== undefined ? cleanName(input.name) || folder.name : folder.name;
    const icon = input.icon && isSpaceIcon(input.icon) ? input.icon : folder.icon;
    return { ...folder, name, icon, collapsed: input.collapsed ?? folder.collapsed };
  });
}

/** Deletes a folder and its sub-folders; `removed` lists their ids (their tabs must follow). */
export function removeFolder(folders: readonly TabFolder[], id: FolderId): { folders: TabFolder[]; removed: Set<FolderId> } {
  if (!folders.some((folder) => folder.id === id)) return { folders: [...folders], removed: new Set() };
  const removed = subtree(folders, id);
  return { folders: folders.filter((folder) => !removed.has(folder.id)), removed };
}

/**
 * Moves a folder under `parentId` (null: root) at `index` among its new siblings. Refused
 * (unchanged list) into itself or its own sub-folders, or when the nesting would be too deep.
 */
export function moveFolder(folders: readonly TabFolder[], id: FolderId, parentId: FolderId | null, index: number): TabFolder[] {
  const folder = folders.find((candidate) => candidate.id === id);
  if (!folder) return [...folders];
  if (parentId && (subtree(folders, id).has(parentId) || !folders.some((candidate) => candidate.id === parentId))) return [...folders];
  if (folderDepth(folders, parentId) + subtreeHeight(folders, id) > MAX_FOLDER_DEPTH) return [...folders];
  const rest = folders.filter((candidate) => candidate.id !== id);
  const siblings = rest.filter((candidate) => candidate.parentId === parentId);
  const clamped = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : siblings.length, siblings.length));
  const moved = { ...folder, parentId };
  // Insert before the sibling now at `clamped`, else after the last sibling (or at the end).
  const before = siblings[clamped];
  const at = before ? rest.indexOf(before) : siblings.length ? rest.indexOf(siblings[siblings.length - 1]) + 1 : rest.length;
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

// --- Tabs in folders ---------------------------------------------------------------------------

/** What these functions need to know about a tab. */
export interface FolderedTab {
  id: string;
  pinned: boolean;
  folderId: FolderId | null;
}

/** The folder a tab is shown in: null for pinned tabs and tabs whose folder is gone. */
function containerOf(tab: FolderedTab, ids: ReadonlySet<FolderId>): FolderId | null {
  return !tab.pinned && tab.folderId && ids.has(tab.folderId) ? tab.folderId : null;
}

/**
 * Tab ids in the order the sidebar shows them: pinned tabs, then depth first from the root
 * (in each container: sub-folders, then its tabs), each group keeping its relative order.
 */
export function visualOrder<T extends FolderedTab>(tabs: readonly T[], folders: readonly TabFolder[]): T[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const result: T[] = tabs.filter((tab) => tab.pinned);
  const visit = (container: FolderId | null, seen: Set<FolderId>) => {
    for (const folder of folders) {
      if (folder.parentId === container && !seen.has(folder.id)) {
        seen.add(folder.id);
        visit(folder.id, seen);
      }
    }
    for (const tab of tabs) if (!tab.pinned && containerOf(tab, ids) === container) result.push(tab);
  };
  visit(null, new Set());
  return result;
}

/**
 * Moves a tab into `folderId` (null: the root), before `beforeId` (a tab of that container), or
 * at the end of the container. Pinned tabs are never filed. Returns the list in visual order.
 */
export function placeTab<T extends FolderedTab>(
  tabs: readonly T[],
  folders: readonly TabFolder[],
  tabId: string,
  folderId: FolderId | null,
  beforeId: string | null,
): T[] {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.pinned || (folderId && !folders.some((folder) => folder.id === folderId))) return visualOrder(tabs, folders);
  const ids = new Set(folders.map((folder) => folder.id));
  const moved = { ...tab, folderId };
  const rest = tabs.filter((candidate) => candidate.id !== tabId);
  const before = beforeId ? rest.findIndex((candidate) => candidate.id === beforeId && containerOf(candidate, ids) === folderId) : -1;
  let at = before;
  if (at === -1) {
    let last = -1;
    rest.forEach((candidate, index) => {
      if (!candidate.pinned && containerOf(candidate, ids) === folderId) last = index;
    });
    at = last === -1 ? rest.length : last + 1;
  }
  return visualOrder([...rest.slice(0, at), moved, ...rest.slice(at)], folders);
}

// --- Sidebar rows and drag and drop ------------------------------------------------------------

export type SidebarRow =
  | { kind: "folder"; folder: TabFolder; depth: number; /** Tabs inside, sub-folders included. */ count: number; /** Has visible rows below it. */ open: boolean }
  | { kind: "tab"; id: string; depth: number; folderId: FolderId | null };

/**
 * The rows of the tab tree (pinned tabs excluded), in display order. A collapsed folder hides its
 * content, except the active tab, which stays visible below it.
 */
export function sidebarRows(tabs: readonly FolderedTab[], folders: readonly TabFolder[], activeId: string | null = null): SidebarRow[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const loose = tabs.filter((tab) => !tab.pinned);
  const rows: SidebarRow[] = [];
  const countIn = (id: FolderId) => {
    const inside = subtree(folders, id);
    return loose.filter((tab) => {
      const container = containerOf(tab, ids);
      return container !== null && inside.has(container);
    }).length;
  };
  const visit = (container: FolderId | null, depth: number, hidden: boolean) => {
    for (const folder of folders) {
      if (folder.parentId !== container) continue;
      const count = countIn(folder.id);
      const open = !folder.collapsed && (count > 0 || folders.some((child) => child.parentId === folder.id));
      if (!hidden) rows.push({ kind: "folder", folder, depth, count, open });
      visit(folder.id, depth + 1, hidden || folder.collapsed);
    }
    for (const tab of loose) {
      if (containerOf(tab, ids) !== container) continue;
      if (!hidden || tab.id === activeId) rows.push({ kind: "tab", id: tab.id, depth, folderId: container });
    }
  };
  visit(null, 0, false);
  return rows;
}

export type DragItem = { kind: "tab"; id: string } | { kind: "folder"; id: FolderId };
/** Where the pointer is on a row: its top part, its middle (folders only), its bottom part. */
export type DropZone = "before" | "inside" | "after";

export type DropResult = (
  | { kind: "tab"; folderId: FolderId | null; beforeId: string | null }
  | { kind: "folder"; parentId: FolderId | null; index: number }
) & {
  /** Where to draw the indicator: a line before/after a row, or the row itself highlighted (`inside`). */
  indicator: { row: number; edge: DropZone };
};

/** The zone of a row under the pointer (`ratio`: 0 at its top, 1 at its bottom). */
export function dropZone(row: SidebarRow, ratio: number, dragging: DragItem["kind"]): DropZone {
  if (row.kind === "tab") return ratio < 0.5 ? "before" : "after";
  // A tab dropped on a folder goes into it (tabs always come after folders in a container).
  if (dragging === "tab") return "inside";
  if (ratio < 0.3) return "before";
  if (ratio > 0.7) return "after";
  return "inside";
}

/** Index among its siblings of the folder at `id`, ignoring `skip`. */
function siblingIndex(folders: readonly TabFolder[], id: FolderId, skip: FolderId): number {
  const folder = folders.find((candidate) => candidate.id === id);
  return folders.filter((candidate) => candidate.parentId === (folder?.parentId ?? null) && candidate.id !== skip).findIndex((candidate) => candidate.id === id);
}

/**
 * Resolves a drop over row `overIndex` (or past the last row when it equals `rows.length`) into
 * the move to make, with an indicator that shows where the item will really land. Null for a
 * no-op or a refused move (a folder into itself, too deep).
 */
export function resolveDrop(
  rows: readonly SidebarRow[],
  folders: readonly TabFolder[],
  drag: DragItem,
  overIndex: number,
  zone: DropZone,
): DropResult | null {
  const over = rows[overIndex] as SidebarRow | undefined;
  const lastRow = rows.length - 1;
  if (drag.kind === "tab") {
    if (!over) return lastRow < 0 ? null : { kind: "tab", folderId: null, beforeId: null, indicator: { row: lastRow, edge: "after" } };
    if (over.kind === "folder") return { kind: "tab", folderId: over.folder.id, beforeId: null, indicator: { row: overIndex, edge: "inside" } };
    if (over.id === drag.id) return null;
    if (zone === "before") return { kind: "tab", folderId: over.folderId, beforeId: over.id, indicator: { row: overIndex, edge: "before" } };
    const next = rows.slice(overIndex + 1).find((row) => row.kind === "tab" && row.folderId === over.folderId && row.depth === over.depth);
    const beforeId = next?.kind === "tab" ? next.id : null;
    if (beforeId === drag.id) return null;
    return { kind: "tab", folderId: over.folderId, beforeId, indicator: { row: overIndex, edge: "after" } };
  }

  const moving = subtree(folders, drag.id);
  const fits = (parentId: FolderId | null) => folderDepth(folders, parentId) + subtreeHeight(folders, drag.id) <= MAX_FOLDER_DEPTH;
  const childFolders = (parentId: FolderId | null) => folders.filter((folder) => folder.parentId === parentId && folder.id !== drag.id).length;
  /** Folders go after the sub-folders of their container: the line goes above its first tab row. */
  const endOf = (parentId: FolderId | null): DropResult | null => {
    if (!fits(parentId)) return null;
    const firstTab = rows.findIndex((row) => row.kind === "tab" && row.folderId === parentId);
    const indicator = firstTab !== -1 ? { row: firstTab, edge: "before" as const } : parentId ? { row: rows.findIndex((row) => row.kind === "folder" && row.folder.id === parentId), edge: "inside" as const } : { row: lastRow, edge: "after" as const };
    return { kind: "folder", parentId, index: childFolders(parentId), indicator };
  };

  if (!over) return endOf(null);
  if (over.kind === "tab") return over.folderId && moving.has(over.folderId) ? null : endOf(over.folderId);
  const target = over.folder;
  if (moving.has(target.id)) return null;
  if (zone === "inside" || (zone === "after" && over.open)) {
    if (!fits(target.id)) return null;
    return zone === "inside"
      ? { kind: "folder", parentId: target.id, index: childFolders(target.id), indicator: { row: overIndex, edge: "inside" } }
      : { kind: "folder", parentId: target.id, index: 0, indicator: { row: overIndex, edge: "after" } };
  }
  if (!fits(target.parentId)) return null;
  const index = siblingIndex(folders, target.id, drag.id) + (zone === "after" ? 1 : 0);
  return { kind: "folder", parentId: target.parentId, index, indicator: { row: overIndex, edge: zone } };
}
