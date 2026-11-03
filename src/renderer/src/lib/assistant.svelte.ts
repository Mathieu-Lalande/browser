import type { TabId } from "@shared/types";

/**
 * Whether the assistant panel is shown (ADR-044), and the tabs the sidebar's selection bar asked
 * to compare: the panel lists them and sends them only once the user confirms.
 */
class AssistantPanelStore {
  open = $state(false);
  compare = $state<TabId[]>([]);

  toggle(): void {
    this.open = !this.open;
  }

  compareTabs(ids: readonly TabId[]): void {
    this.compare = [...ids];
    this.open = true;
  }
}

export const assistantPanel = new AssistantPanelStore();
