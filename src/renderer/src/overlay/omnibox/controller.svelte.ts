import type { ArchivedTab } from "@shared/archive";
import type { CommandDefinition } from "@shared/commands";
import { Omnibox, sharedProviders } from "@shared/omnibox/omnibox";
import { parseScope } from "@shared/omnibox/scopes";
import { SETTINGS_INDEX } from "@shared/omnibox/settings-index";
import type { OmniboxAnnotation, OmniboxData, OmniboxTab, OpenDisposition, ScopeId, Suggestion } from "@shared/omnibox/types";
import type { Bookmark, HistoryEntry } from "@shared/types";
import { api, browser } from "../../lib/browser.svelte";
import { platform } from "../../lib/platform.svelte";
import { settings } from "../../lib/settings.svelte";
import { sync } from "../../lib/sync.svelte";

const HISTORY_LIMIT = 12;

/** Keys of Enter → where a page opens (ADR-032). */
export function dispositionOf(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): OpenDisposition {
  if (event.ctrlKey || event.metaKey) return "new";
  if (event.shiftKey) return "split";
  if (event.altKey) return "background";
  return "current";
}

/**
 * State of the universal bar in the overlay: input, scope chip, selection, and the data the
 * shared providers read. Remounted at each opening (fresh state), so lists are fetched once and
 * filtered locally; only history is asked to main per keystroke.
 */
export class OmniboxController {
  input = $state("");
  scope = $state<ScopeId | null>(null);
  selected = $state(0);
  /** A destructive command waiting for confirmation (replaces the results). */
  confirming = $state<CommandDefinition | null>(null);

  private history = $state.raw<{ text: string; entries: HistoryEntry[] }>({ text: "", entries: [] });
  private bookmarks = $state.raw<Bookmark[]>([]);
  private archived = $state.raw<ArchivedTab[]>([]);
  private annotations = $state.raw<OmniboxAnnotation[]>([]);
  /** Every space's tabs; until main answers, the space on screen (from the state) is enough. */
  private allTabs = $state.raw<OmniboxTab[] | null>(null);
  private request = 0;
  private readonly omnibox = new Omnibox(sharedProviders());

  /** Text the providers search (without a typed `@scope ` prefix). */
  readonly text = $derived(this.scope ? this.input.trim() : parseScope(this.input).text.trim());
  readonly result = $derived(this.omnibox.query(this.input, this.data(), this.scope));
  readonly items = $derived(this.result.items);
  readonly current = $derived(Math.min(this.selected, this.items.length - 1));
  readonly selection = $derived(this.items[this.current] as Suggestion | undefined);

  constructor(private readonly onClose: (restoreFocus: boolean) => void) {
    api.bookmarks.list().then((list) => (this.bookmarks = list), () => {});
    api.archive.list().then((list) => (this.archived = list), () => {});
    api.annotations.list().then((list) => (this.annotations = list.highlights), () => {});
    api.omnibox.tabs().then((tabs) => (this.allTabs = tabs), () => {});
  }

  private data(): OmniboxData {
    const { state } = browser;
    const shown = state.spaces.find((space) => space.id === state.activeSpaceId);
    const tabs =
      this.allTabs ??
      state.tabs.map((tab) => ({ ...tab, spaceId: state.activeSpaceId || null, spaceName: shown?.name }));
    return {
      tabs,
      activeTabId: state.activeTabId,
      activeSpaceId: state.activeSpaceId || null,
      favorites: state.favorites ?? [],
      bookmarks: this.bookmarks,
      // Only results for the text on screen: Enter must never run a row computed for older text.
      history: this.history.text === this.text ? this.history.entries : [],
      // Private windows open them like any link, but the list itself is the account's.
      remoteTabs: sync.remoteTabs,
      archived: this.archived,
      annotations: this.annotations,
      commandContext: { activeTab: browser.activeTab },
      shortcut: (id) => platform.keys(id),
      settings: SETTINGS_INDEX,
      engine: settings.engine,
      now: Date.now(),
    };
  }

  /** The user typed: a complete `@scope ` prefix becomes the chip. */
  setInput(value: string): void {
    const parsed = this.scope ? null : parseScope(value);
    if (parsed?.scope) {
      this.scope = parsed.scope;
      this.input = parsed.text;
    } else {
      this.input = value;
    }
    this.selected = 0;
    void this.refreshHistory();
  }

  setScope(scope: ScopeId | null): void {
    this.scope = scope;
    if (scope) this.input = parseScope(this.input).pending !== null ? "" : this.input;
    this.selected = 0;
    void this.refreshHistory();
  }

  private async refreshHistory(): Promise<void> {
    const id = ++this.request;
    const text = this.text;
    if (this.scope && this.scope !== "history") return;
    // Most visited sites when the history scope has no text yet.
    const entries = await (text ? api.history.search(text, HISTORY_LIMIT) : this.scope === "history" ? api.history.topSites(HISTORY_LIMIT) : Promise.resolve([])).catch(() => []);
    // A newer keystroke already asked for fresher results.
    if (id === this.request) this.history = { text, entries };
  }

  move(delta: number): void {
    if (this.items.length === 0) return;
    this.selected = (this.current + delta + this.items.length) % this.items.length;
  }

  /** Tab: the selected row's completion goes into the input (a scope row sets the chip). */
  complete(): void {
    const item = this.selection;
    if (!item) return;
    if (item.action.type === "scope") this.setScope(item.action.scope);
    else if (item.completion && item.completion !== this.input) this.setInput(item.completion);
  }

  /** Runs a row. Pages open where `disposition` says; tabs and commands ignore it (split aside). */
  perform(item: Suggestion | undefined, disposition: OpenDisposition): void {
    if (!item) return;
    const { action } = item;
    switch (action.type) {
      case "tab":
        if (disposition === "split" && action.spaceId === (browser.state.activeSpaceId || null)) api.split.open(action.tabId);
        else if (action.spaceId) api.omnibox.showTab(action.spaceId, action.tabId);
        else api.tabs.activate(action.tabId);
        break;
      case "open":
        api.omnibox.open(action.url, disposition);
        break;
      case "favorite":
        if (disposition === "current") api.favorites.open(action.url);
        else api.omnibox.open(action.url, disposition);
        break;
      case "archived":
        api.archive.restore(action.archiveId);
        break;
      case "copy":
        api.omnibox.copy(action.text);
        break;
      case "scope":
        this.setScope(action.scope);
        return;
      case "command":
        if (action.command.confirm) {
          this.confirming = action.command;
          return;
        }
        api.commands.run(action.command.id);
        // Its popover replaces the bar in the overlay layer, which must stay attached.
        if (action.command.opensOverlay) return;
        break;
      case "custom":
        return;
    }
    // Sent after the action: main then focuses the (possibly new) active page.
    this.onClose(false);
  }

  confirm(): void {
    if (this.confirming) api.commands.run(this.confirming.id);
    this.onClose(false);
  }

  cancelConfirm(): void {
    this.confirming = null;
  }

  close(): void {
    this.onClose(true);
  }
}
