import type { BrowserState, TabState } from "@shared/types";

/** Reactive mirror of the main-process browser state for this window. */
class BrowserStore {
  state = $state<BrowserState>({ tabs: [], activeTabId: null });

  activeTab: TabState | undefined = $derived(this.state.tabs.find((tab) => tab.id === this.state.activeTabId));
  pinnedTabs: TabState[] = $derived(this.state.tabs.filter((tab) => tab.isPinned));
  regularTabs: TabState[] = $derived(this.state.tabs.filter((tab) => !tab.isPinned));

  constructor() {
    window.browser.onState((next) => (this.state = next));
    void window.browser.getState().then((initial) => {
      if (initial) this.state = initial;
    });
  }
}

export const browser = new BrowserStore();
export const api = window.browser;
