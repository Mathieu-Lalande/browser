import { randomUUID } from "node:crypto";
import { addFolder, moveFolder, placeTab, removeFolder, updateFolder, visualOrder, type FolderId, type FolderInput, type TabFolder } from "@shared/folders";
import type { TabId } from "@shared/types";
import type { TabStore } from "./store";

/** What TabFolders needs from the rest of its TabManager. */
export interface FolderDeps {
  readonly store: TabStore;
  close(id: TabId): void;
  emit(): void;
}

/**
 * Sidebar folders of one space (ADR-022, model in @shared/folders); tabs point to them with
 * `state.folderId`, and the tab list is kept in the order the sidebar shows.
 */
export class TabFolders {
  private folders: TabFolder[] = [];

  constructor(private readonly deps: FolderDeps) {}

  /** Copies of the folders, for the UI state and the saved session. */
  list(): TabFolder[] {
    return this.folders.map((folder) => ({ ...folder }));
  }

  get size(): number {
    return this.folders.length;
  }

  has(id: FolderId): boolean {
    return this.folders.some((folder) => folder.id === id);
  }

  restore(saved: readonly TabFolder[] | undefined): void {
    this.folders = (saved ?? []).map((folder) => ({ ...folder }));
  }

  /**
   * Creates a folder (in `parentId`, or at the root), optionally moving tabs into it. Returns its
   * id, or null at the limit / too deep.
   */
  create(input: FolderInput = {}, parentId: FolderId | null = null, tabIds: readonly TabId[] = []): FolderId | null {
    const id = randomUUID();
    const next = addFolder(this.folders, id, parentId, input);
    if (!next) return null;
    this.folders = next;
    for (const tabId of tabIds) this.placeTab(tabId, id, null);
    this.reorder();
    this.deps.emit();
    return id;
  }

  update(id: FolderId, input: FolderInput): void {
    if (!this.has(id)) return;
    this.folders = updateFolder(this.folders, id, input);
    this.deps.emit();
  }

  /** Deletes a folder and its sub-folders; their tabs are closed, or go back to the parent container. */
  remove(id: FolderId, closeTabs: boolean): void {
    const parentId = this.folders.find((folder) => folder.id === id)?.parentId ?? null;
    const { folders, removed } = removeFolder(this.folders, id);
    if (!removed.size) return;
    this.folders = folders;
    const filed = this.deps.store.all.filter((tab) => tab.state.folderId && removed.has(tab.state.folderId));
    for (const tab of filed) tab.state.folderId = parentId;
    this.reorder();
    if (closeTabs) for (const tab of filed) this.deps.close(tab.id);
    this.deps.emit();
  }

  move(id: FolderId, parentId: FolderId | null, index: number): void {
    this.folders = moveFolder(this.folders, id, parentId, index);
    this.reorder();
    this.deps.emit();
  }

  /** Moves a tab into a folder (null: the root), before `beforeId` or at the end of it. */
  placeTab(tabId: TabId, folderId: FolderId | null, beforeId: TabId | null): void {
    const { store } = this.deps;
    const placed = placeTab(this.items(), this.folders, tabId, folderId, beforeId);
    const byId = new Map(store.all.map((tab) => [tab.id, tab]));
    store.setOrder(
      placed.map((item) => {
        const tab = byId.get(item.id)!;
        tab.state.folderId = item.folderId;
        return tab;
      }),
    );
    this.deps.emit();
  }

  /** Keeps the flat list in the order the sidebar shows (Ctrl+Tab follows the screen). */
  reorder(): void {
    const { store } = this.deps;
    const byId = new Map(store.all.map((tab) => [tab.id, tab]));
    store.setOrder(visualOrder(this.items(), this.folders).map((item) => byId.get(item.id)!));
  }

  private items() {
    return this.deps.store.all.map((tab) => ({ id: tab.id, pinned: tab.state.isPinned, folderId: tab.state.folderId ?? null }));
  }
}
