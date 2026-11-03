import type { SpaceId, TabId } from "@shared/types";
import { api, browser } from "./browser.svelte";

/** Selection of several tabs in the sidebar (ADR-033): close, file in a new folder, or move them together. */
export class TabSelection {
  #selected = $state<TabId[]>([]);
  /** The selected tabs still there (tabs that went away, or got pinned, leave the selection). */
  readonly ids: TabId[] = $derived(this.#selected.filter((id) => browser.state.tabs.some((item) => item.id === id && !item.isPinned)));

  has(id: TabId): boolean {
    return this.ids.includes(id);
  }

  toggle(id: TabId): void {
    this.#selected = this.has(id) ? this.ids.filter((other) => other !== id) : [...this.ids, id];
  }

  /** "Sélectionner tous les onglets": every unpinned tab of the space shown. */
  selectAll(): void {
    this.#selected = browser.regularTabs.map((item) => item.id);
  }

  clear(): void {
    this.#selected = [];
  }

  close(): void {
    for (const id of this.ids) api.tabs.close(id);
    this.clear();
  }

  /** Files the selected tabs in a new folder. */
  toFolder(): void {
    api.folders.create({}, null, this.ids);
    this.clear();
  }

  moveTo(spaceId: SpaceId): void {
    for (const id of this.ids) api.tabs.moveToSpace(id, spaceId);
    this.clear();
  }
}
