import { sidebarRows, type SidebarRow, type TabFolder } from "@shared/folders";
import type { SpacePeek, TabState } from "@shared/types";

/** A folder row of the sidebar's tab tree. */
export type FolderRow = Extract<SidebarRow, { kind: "folder" }>;

/** A tab tree entry: a tab, the tabs of a split (one entry), or a folder. `index` is its row. */
export type TreeEntry =
  | { key: string; index: number; depth: number; tab: TabState }
  | { key: string; index: number; depth: number; split: TabState[] }
  | { key: string; index: number; depth: number; folder: FolderRow };

/** The tab tree's rows (ADR-022): folders and regular tabs, depth first (sub-folders, then tabs). */
export const treeRows = (tabs: readonly TabState[], folders: readonly TabFolder[], activeId: string | null): SidebarRow[] =>
  sidebarRows(
    tabs.map((item) => ({ id: item.id, pinned: item.isPinned, folderId: item.folderId ?? null })),
    folders,
    activeId,
  );

/**
 * The entries of the tab tree: each row, except that the tabs of a split (`splitIds`, in pane
 * order) are gathered in one entry at the place of the first of them.
 */
export function treeEntries(rows: readonly SidebarRow[], tabs: readonly TabState[], splitIds: readonly string[]): TreeEntry[] {
  const members = splitIds.map((id) => tabs.find((item) => item.id === id && !item.isPinned)).filter((item) => item !== undefined);
  const list: TreeEntry[] = [];
  let placed = false;
  rows.forEach((row, index) => {
    if (row.kind === "folder") {
      list.push({ key: `folder-${row.folder.id}`, index, depth: row.depth, folder: row });
      return;
    }
    const item = tabs.find((candidate) => candidate.id === row.id);
    if (!item) return;
    if (!splitIds.includes(item.id) || members.length < 2) list.push({ key: item.id, index, depth: row.depth, tab: item });
    else if (!placed) {
      placed = true;
      list.push({ key: `split-${members[0].id}`, index, depth: row.depth, split: members });
    }
  });
  return list;
}

/** A neighbour space's rows, as its own sidebar would list them (folders, then loose tabs). */
export type PeekRow = { key: string; depth: number; tab: TabState } | { key: string; depth: number; folder: FolderRow };

export function peekRows(peek: SpacePeek): PeekRow[] {
  return treeRows(peek.tabs, peek.folders ?? [], peek.activeTabId).flatMap((row): PeekRow[] => {
    if (row.kind === "folder") return [{ key: `folder-${row.folder.id}`, depth: row.depth, folder: row }];
    const item = peek.tabs.find((candidate) => candidate.id === row.id);
    return item ? [{ key: item.id, depth: row.depth, tab: item }] : [];
  });
}
