<script lang="ts">
  import { effectiveAccelerator, shortcutKeys, type CommandDefinition } from "@shared/commands";
  import { settings } from "../lib/settings.svelte";
  import { buildPalette, type PaletteItem } from "@shared/palette";
  import { mergeSuggestions, type Suggestion } from "@shared/search";
  import type { ArchivedTab } from "@shared/archive";
  import type { Bookmark } from "@shared/types";
  import { api, browser } from "../lib/browser.svelte";
  import { sync } from "../lib/sync.svelte";
  import Favicon from "../components/Favicon.svelte";
  import Icon from "../components/Icon.svelte";
  import Highlight from "./Highlight.svelte";

  let { onClose }: { onClose: (restoreFocus: boolean) => void } = $props();

  const MAX_SUGGESTIONS = 6;
  const isMac = window.platform === "darwin";
  const mod = isMac ? "⌘" : "Ctrl";

  let input = $state<HTMLInputElement>();
  let list = $state<HTMLElement>();
  let query = $state("");
  let selected = $state(0);
  let suggestions = $state<Suggestion[]>([]);
  /** A destructive command waiting for confirmation (replaces the results). */
  let confirming = $state<CommandDefinition | null>(null);
  let bookmarks: Bookmark[] = [];
  let archived = $state<ArchivedTab[]>([]);
  let request = 0;

  const activeTab = $derived(browser.activeTab);
  const sections = $derived(
    buildPalette({
      query,
      tabs: browser.state.tabs,
      activeTabId: browser.state.activeTabId,
      suggestions,
      context: { activeTab },
      // Private windows open them like any link, but the list itself is the account's.
      remoteTabs: sync.remoteTabs,
      archivedTabs: archived,
    }),
  );
  /** Sections with the flat index of their first row (keyboard selection is flat). */
  const groups = $derived.by(() => {
    let offset = 0;
    return sections.map((section) => {
      const group = { section, offset };
      offset += section.items.length;
      return group;
    });
  });
  const items = $derived(sections.flatMap((section) => section.items));
  const current = $derived(Math.min(selected, items.length - 1));
  /** Only the web row is left: nothing open or known matches. */
  const nothingFound = $derived(query.trim() !== "" && sections.every((section) => section.id === "web" || section.id === "go"));

  // Bookmarks are few: fetched once per opening (the palette is remounted), filtered locally while typing.
  api.bookmarks.list().then((list) => (bookmarks = list), () => {});
  // The archive too (ADR-022): searched locally, the palette is remounted at each opening.
  api.archive.list().then((list) => (archived = list), () => {});

  $effect(() => {
    input?.focus();
  });

  // Keep the keyboard selection visible; on the first row, the list starts at the top so the first
  // section's heading ("Onglets récents", "Actions") shows too.
  $effect(() => {
    if (current <= 0 && list) list.scrollTop = 0;
    else list?.querySelector(`#palette-item-${current}`)?.scrollIntoView({ block: "nearest" });
  });

  async function refreshSuggestions(text: string): Promise<void> {
    const id = ++request;
    // Suggestions for older text go right away: Arrow/Enter must never run one while the new ones load.
    suggestions = [];
    if (!text.trim()) return;
    const history = await api.history.search(text, MAX_SUGGESTIONS + 4).catch(() => []);
    // A newer keystroke already asked for fresher results.
    if (id === request) suggestions = mergeSuggestions(text, history, bookmarks, MAX_SUGGESTIONS + 4);
  }

  function onInput(event: Event & { currentTarget: HTMLInputElement }): void {
    query = event.currentTarget.value;
    selected = 0;
    void refreshSuggestions(query);
  }

  function openUrl(url: string, newTab: boolean): void {
    if (!newTab && activeTab) api.tabs.navigate(activeTab.id, url);
    else api.tabs.create(url);
  }

  /** Runs a row. Ctrl/⌘ (Enter or click) opens pages in a new tab. */
  function perform(item: PaletteItem | undefined, newTab: boolean): void {
    if (!item) return;
    switch (item.kind) {
      case "tab":
        api.tabs.activate(item.tab.id);
        break;
      case "archived":
        api.archive.restore(item.archiveId);
        break;
      case "command":
        if (item.command.confirm) {
          confirming = item.command;
          return;
        }
        api.commands.run(item.command.id);
        // Its popover replaces the palette in the overlay layer, which must stay attached.
        if (item.command.opensOverlay) return;
        break;
      default:
        openUrl(item.url, newTab);
    }
    // Sent after the action: main then focuses the (possibly new) active page.
    onClose(false);
  }

  function confirm(): void {
    if (confirming) api.commands.run(confirming.id);
    onClose(false);
  }

  function cancelConfirm(): void {
    confirming = null;
    queueMicrotask(() => input?.focus());
  }

  function move(delta: number): void {
    if (items.length === 0) return;
    selected = (current + delta + items.length) % items.length;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (confirming) cancelConfirm();
      else onClose(true);
      return;
    }
    if (confirming) return;
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      perform(items[current], event.ctrlKey || event.metaKey);
    }
  }

  /** Last pointer position: the panel appearing (or scrolling) under a still cursor is not a hover. */
  let pointer: { x: number; y: number } | null = null;

  function onPointer(event: MouseEvent, position: number): void {
    const moved = pointer !== null && (pointer.x !== event.screenX || pointer.y !== event.screenY);
    pointer = { x: event.screenX, y: event.screenY };
    if (moved) selected = position;
  }

  /** The command's effective shortcut: the user's choice first (ADR-028). */
  function shortcut(command: CommandDefinition): string[] {
    const accelerator = effectiveAccelerator(command.id, window.platform, settings.current.shortcuts);
    return accelerator ? shortcutKeys(accelerator, window.platform) : [];
  }

  const verbs: Record<PaletteItem["kind"], string> = {
    tab: "Basculer",
    command: "Exécuter",
    bookmark: "Ouvrir",
    history: "Ouvrir",
    navigate: "Ouvrir",
    remote: "Ouvrir",
    archived: "Restaurer",
    search: "Rechercher",
  };
</script>

<svelte:window onkeydown={onKeydown} />

<div class="panel" role="dialog" aria-modal="true" aria-label="Palette de commandes">
  {#if confirming}
    <div class="confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-detail">
      <span class="confirm-icon"><Icon name={confirming.icon} size={20} /></span>
      <h2 id="confirm-title">{confirming.confirm?.title}</h2>
      <p id="confirm-detail">{confirming.confirm?.detail}</p>
      <div class="buttons">
        <!-- The safe choice has the focus: Enter never destroys by accident. -->
        <!-- svelte-ignore a11y_autofocus -->
        <button class="button" autofocus onclick={cancelConfirm}>Annuler</button>
        <button class="button danger" onclick={confirm}>{confirming.confirm?.action}</button>
      </div>
    </div>
  {:else}
    <div class="search">
      <Icon name="search" size={20} />
      <input
        bind:this={input}
        value={query}
        oninput={onInput}
        placeholder="Rechercher des onglets, des pages ou des actions"
        spellcheck="false"
        autocomplete="off"
        aria-label="Palette de commandes"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-results"
        aria-autocomplete="list"
        aria-activedescendant={items.length ? `palette-item-${current}` : undefined}
      />
    </div>

    <div class="results" id="palette-results" role="listbox" aria-label="Résultats" bind:this={list}>
      {#if nothingFound}
        <p class="empty">Aucun onglet, favori ni action ne correspond.</p>
      {/if}
      {#each groups as { section, offset } (section.id)}
        <div class="group" role="group" aria-labelledby={section.title ? `palette-section-${section.id}` : undefined}>
          {#if section.title}
            <div class="heading" id="palette-section-{section.id}" role="presentation">{section.title}</div>
          {/if}
          {#each section.items as item, index (item.key)}
            {@const position = offset + index}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="row"
              id="palette-item-{position}"
              role="option"
              tabindex="-1"
              aria-selected={position === current}
              class:selected={position === current}
              onmousemove={(event) => onPointer(event, position)}
              onmousedown={(event) => event.preventDefault()}
              onclick={(event) => perform(item, event.ctrlKey || event.metaKey)}
            >
              <span class="icon" class:tile={item.kind === "command" || item.kind === "search" || item.kind === "navigate" || item.kind === "remote"}>
                {#if item.kind === "command"}
                  <Icon name={item.command.icon} size={16} />
                {:else if item.kind === "search"}
                  <Icon name="search" size={16} />
                {:else if item.kind === "navigate"}
                  <Icon name="arrow" size={16} />
                {:else if item.kind === "remote"}
                  <Icon name="cloud" size={16} />
                {:else if item.kind === "tab"}
                  <Favicon src={item.tab.favicon} loading={item.tab.isLoading} />
                {:else if item.kind === "bookmark" || item.kind === "history" || item.kind === "archived"}
                  <Favicon src={item.favicon} />
                {/if}
              </span>
              <span class="text">
                <span class="title"><Highlight text={item.title} ranges={item.titleRanges} /></span>
                {#if item.detail}
                  <span class="detail"><Highlight text={item.detail} ranges={item.detailRanges} /></span>
                {/if}
              </span>
              {#if item.kind === "bookmark"}
                <span class="badge" title="Favori"><Icon name="star" size={12} filled /></span>
              {:else if item.kind === "archived"}
                <span class="badge" title="Onglet archivé"><Icon name="archive" size={12} /></span>
              {/if}
              {#if item.kind === "command" && shortcut(item.command).length}
                <span class="keys" aria-label="Raccourci">
                  {#each shortcut(item.command) as key, keyIndex (keyIndex)}<kbd>{key}</kbd>{/each}
                </span>
              {:else if position === current}
                <span class="hint">{verbs[item.kind]} <Icon name="enter" size={12} /></span>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>

    <footer>
      <span><kbd>↑</kbd><kbd>↓</kbd> Naviguer</span>
      <span><kbd>↵</kbd> Ouvrir</span>
      <span><kbd>{mod}</kbd><kbd>↵</kbd> Nouvel onglet</span>
      <span class="spacer"></span>
      <span><kbd>Échap</kbd> Fermer</span>
    </footer>
  {/if}
</div>

<style>
  .panel {
    position: absolute;
    top: max(56px, 14vh);
    left: 50%;
    display: flex;
    flex-direction: column;
    width: min(640px, calc(100vw - 48px));
    max-height: min(540px, calc(100vh - max(56px, 14vh) - 32px));
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.18),
      0 2px 6px rgb(0 0 0 / 0.12),
      0 24px 56px -16px rgb(0 0 0 / 0.45);
    transform: translateX(-50%);
    animation: pop 0.16s var(--ease);
  }
  @media (prefers-color-scheme: light) {
    .panel {
      box-shadow:
        0 0 0 1px rgb(20 10 40 / 0.06),
        0 2px 6px rgb(20 10 40 / 0.06),
        0 24px 60px -16px rgb(20 10 40 / 0.3);
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-6px) scale(0.98);
    }
  }

  .search {
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
    height: 58px;
    padding: 0 16px 0 18px;
    border-bottom: 1px solid var(--border);
    color: var(--accent-text);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-size: 17px;
    letter-spacing: -0.01em;
    user-select: text;
  }
  input::placeholder {
    color: var(--text-faint);
  }

  .results {
    flex: 1;
    min-height: 0;
    padding: 6px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-color: var(--surface-active) transparent;
    scrollbar-width: thin;
  }
  .group + .group {
    margin-top: 4px;
  }
  .heading {
    padding: 8px 10px 4px;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 6px 10px;
    border-radius: 10px;
    color: var(--text-muted);
    scroll-margin: 6px;
  }
  .row.selected {
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--text);
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
  }
  .icon.tile {
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border);
    color: var(--text-muted);
  }
  .row.selected .icon.tile {
    background: color-mix(in oklab, var(--accent) 22%, transparent);
    color: var(--accent-text);
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    white-space: nowrap;
  }
  .title,
  .detail {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title {
    color: var(--text);
    font-size: 13.5px;
  }
  .detail {
    color: var(--text-faint);
    font-size: 11.5px;
  }
  .badge {
    display: grid;
    color: var(--accent-text);
  }
  .keys {
    display: flex;
    flex: none;
    gap: 3px;
  }
  .hint {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    color: var(--text-faint);
    font-size: 11.5px;
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--surface);
    color: var(--text-muted);
    font: 500 11px/1 var(--font);
  }
  .empty {
    margin: 0;
    padding: 18px 12px 10px;
    color: var(--text-faint);
    text-align: center;
  }

  footer {
    display: flex;
    flex: none;
    align-items: center;
    gap: 14px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 11.5px;
  }
  footer span {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  footer kbd {
    min-width: 18px;
    height: 18px;
    font-size: 10.5px;
  }
  .spacer {
    flex: 1;
  }

  .confirm {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 28px 28px 22px;
    text-align: center;
  }
  .confirm-icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-bottom: 14px;
    border-radius: 12px;
    background: rgb(239 68 68 / 0.14);
    color: #ef4444;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 16px;
    font-weight: 600;
  }
  .confirm p {
    max-width: 420px;
    margin: 0 0 20px;
    color: var(--text-muted);
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  .button {
    height: 34px;
    padding: 0 16px;
    border-radius: 9px;
    background: var(--surface-hover);
  }
  .button:hover {
    background: var(--surface-active);
  }
  .button.danger {
    background: #dc2626;
    color: #fff;
  }
  .button.danger:hover {
    background: #b91c1c;
  }
</style>
