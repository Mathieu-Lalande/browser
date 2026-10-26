import type { BrowserState, SpaceInfo, TabState } from "@shared/types";

/** Reactive mirror of the main-process browser state for this window. */
class BrowserStore {
  state = $state<BrowserState>({ tabs: [], activeTabId: null, split: null, spaces: [], activeSpaceId: "" });

  activeTab: TabState | undefined = $derived(this.state.tabs.find((tab) => tab.id === this.state.activeTabId));
  pinnedTabs: TabState[] = $derived(this.state.tabs.filter((tab) => tab.isPinned));
  regularTabs: TabState[] = $derived(this.state.tabs.filter((tab) => !tab.isPinned));
  activeSpace: SpaceInfo | undefined = $derived(this.state.spaces.find((space) => space.id === this.state.activeSpaceId));
  /** Tabs of the split in pane order, while it is on screen (the active tab is one of them). */
  splitTabs: TabState[] = $derived.by(() => {
    const { split, activeTabId, tabs } = this.state;
    if (!split || !activeTabId || !split.tabIds.includes(activeTabId)) return [];
    return split.tabIds.map((id) => tabs.find((tab) => tab.id === id)).filter((tab) => tab !== undefined);
  });

  /** Private window (ADR-014): private theme, no spaces, no top sites. */
  isPrivate: boolean = $derived(this.state.isPrivate === true);
  /** Resolves once the first state arrived (the private theme must apply before the first render). */
  readonly ready: Promise<void>;

  constructor() {
    window.browser.onState((next) => (this.state = next));
    this.ready = window.browser.getState().then(
      (initial) => {
        if (initial) this.state = initial;
      },
      () => {},
    );
  }
}

export const browser = new BrowserStore();
export const api = window.browser;
