import type { TidyGroup, TidyProposal, TidyScope } from "@shared/tab-tidy";
import { api } from "./browser.svelte";

/**
 * "Ranger les onglets" (ADR-059), UI side: the proposal shown in the sidebar, whose groups the
 * user renames or leaves out before folders are created (with the existing `folders.create`).
 */
export interface EditableGroup extends TidyGroup {
  keep: boolean;
}

class TabTidy {
  open = $state(false);
  loading = $state(false);
  proposal = $state<Omit<TidyProposal, "groups"> | null>(null);
  groups = $state<EditableGroup[]>([]);

  async start(scope: TidyScope = "loose"): Promise<void> {
    this.open = true;
    this.loading = true;
    this.groups = [];
    try {
      const { groups, ...rest } = await api.tabs.tidy(scope);
      this.proposal = rest;
      this.groups = groups.map((group) => ({ ...group, keep: true }));
    } catch {
      this.proposal = null;
    } finally {
      this.loading = false;
    }
  }

  apply(): void {
    for (const group of this.groups) if (group.keep && group.name.trim()) api.folders.create({ name: group.name.trim() }, null, [...group.tabIds]);
    this.close();
  }

  close(): void {
    this.open = false;
    this.groups = [];
    this.proposal = null;
  }
}

export const tabTidy = new TabTidy();

api.onUiCommand((command) => {
  if (command === "tidy-tabs") void tabTidy.start();
});
