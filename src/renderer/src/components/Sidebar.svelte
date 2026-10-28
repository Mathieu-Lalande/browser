<script lang="ts">
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";
  import type { SpaceId, TabState } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../lib/browser.svelte";
  import AddressBar from "./AddressBar.svelte";
  import DownloadsButton from "./downloads/DownloadsButton.svelte";
  import { settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";
  import { platform } from "../lib/platform.svelte";
  import TabIcon from "./TabIcon.svelte";
  import TabItem from "./TabItem.svelte";
  import WindowControls from "./WindowControls.svelte";
  import SpaceEditor from "./spaces/SpaceEditor.svelte";
  import SpaceSwitcher from "./spaces/SpaceSwitcher.svelte";
  import SplitGroup from "./split/SplitGroup.svelte";

  /**
   * `windowControls`: draw the window buttons in the title bar (Windows/Linux, see App): at its
   * start with the sidebar on the left, at its end (the window's right edge) with it on the right.
   */
  let { onToggle, windowControls = false }: { onToggle: () => void; windowControls?: boolean } = $props();
  let addressBar: AddressBar;
  let tabList = $state<HTMLElement>();

  const tab = $derived(browser.activeTab);
  // macOS traffic lights sit at the window's top-left: only a left sidebar makes room for them.
  const controlsAtEnd = $derived(settings.current.layout.sidebarPosition === "right");
  const roomForTrafficLights = $derived(platform.isMac && settings.current.layout.sidebarPosition === "left");
  const zen = $derived(settings.current.layout.zenMode);

  export function focusAddress(): void {
    addressBar.focus();
  }

  /** Space whose edit popover is open. */
  let editing = $state<SpaceId | null>(null);
  const editedSpace = $derived(browser.state.spaces.find((space) => space.id === editing));

  // Switching spaces slides the tab list in from the side of the new space.
  const spaceIndex = $derived(browser.state.spaces.findIndex((space) => space.id === browser.state.activeSpaceId));
  let previousIndex = -1;
  let direction = $state(1);
  $effect.pre(() => {
    const index = spaceIndex;
    direction = index >= previousIndex ? 1 : -1;
    previousIndex = index;
  });

  /** Regular tabs, with the tabs of a split gathered in one entry (in pane order) at the place of its first tab. */
  type Entry = { key: string; tab: TabState } | { key: string; split: TabState[] };
  const entries = $derived.by((): Entry[] => {
    const splitIds = browser.state.split?.tabIds ?? [];
    const members = splitIds.map((id) => browser.regularTabs.find((item) => item.id === id)).filter((item) => item !== undefined);
    const list: Entry[] = [];
    let placed = false;
    for (const item of browser.regularTabs) {
      if (!splitIds.includes(item.id) || members.length < 2) list.push({ key: item.id, tab: item });
      else if (!placed) {
        placed = true;
        list.push({ key: `split-${members[0].id}`, split: members });
      }
    }
    return list;
  });

  /** The tab list's single Tab stop (roving tabindex): the active tab, else the first one. */
  const focusId = $derived(
    browser.regularTabs.some((item) => item.id === browser.state.activeTabId) ? browser.state.activeTabId : (browser.regularTabs[0]?.id ?? null),
  );

  /** Bring the active tab into view (switching tabs from the palette, a shortcut, a new tab…). */
  $effect(() => {
    const id = browser.state.activeTabId;
    if (!id || !tabList) return;
    queueMicrotask(() => tabList?.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  });

  /**
   * Keyboard navigation of the tab list (WAI-ARIA tabs pattern, vertical): arrows and Home/End
   * move the focus, Enter/Space activate, Delete/Backspace close the focused tab.
   */
  function onTabsKeydown(event: KeyboardEvent): void {
    const items = [...(tabList?.querySelectorAll<HTMLElement>("[role=tab]") ?? [])];
    const current = items.findIndex((item) => item === document.activeElement);
    if (current === -1) return;
    const id = items[current].dataset.tabId!;
    const focus = (index: number) => {
      const target = items[Math.max(0, Math.min(items.length - 1, index))];
      for (const item of items) item.tabIndex = item === target ? 0 : -1;
      target?.focus();
      target?.scrollIntoView({ block: "nearest" });
    };
    switch (event.key) {
      case "ArrowDown":
        focus(current + 1);
        break;
      case "ArrowUp":
        focus(current - 1);
        break;
      case "Home":
        focus(0);
        break;
      case "End":
        focus(items.length - 1);
        break;
      case "Enter":
      case " ":
        api.tabs.activate(id);
        break;
      case "Delete":
      case "Backspace": {
        // Focus moves to the neighbour that takes the closed tab's place.
        const next = items[current + 1] ?? items[current - 1];
        api.tabs.close(id);
        if (next) {
          const nextId = next.dataset.tabId;
          setTimeout(() => tabList?.querySelector<HTMLElement>(`[data-tab-id="${nextId}"]`)?.focus(), 50);
        }
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }

  function newTab(): void {
    api.tabs.create();
    focusAddress();
  }
</script>

<aside class="sidebar">
  <header class="titlebar drag" class:mac={roomForTrafficLights}>
    {#if windowControls && !controlsAtEnd}<WindowControls />{/if}
    {#if browser.isPrivate}
      <div class="private-badge" title="Navigation privée : ni historique, ni cookies conservés après la fermeture de la fenêtre">
        <Icon name="mask" size={16} />
        <span>Navigation privée</span>
      </div>
    {/if}
    <div class="spacer"></div>
    <button
      class="icon no-drag"
      class:on={zen}
      aria-label="Mode zen"
      aria-pressed={zen}
      title={platform.tip("Mode zen", "toggle-zen")}
      onclick={() => settings.update({ layout: { zenMode: !zen } })}
    >
      <Icon name="zen" />
    </button>
    <button class="icon no-drag" aria-label="Masquer la barre latérale" title={platform.tip("Masquer la barre latérale", "toggle-sidebar")} onclick={onToggle}>
      <Icon name="sidebar" />
    </button>
    {#if windowControls && controlsAtEnd}<WindowControls />{/if}
  </header>

  <nav class="nav">
    <button class="icon" aria-label="Précédent" title={platform.tip("Précédent", "back")} disabled={!tab?.canGoBack} onclick={() => tab && api.tabs.back(tab.id)}>
      <Icon name="back" />
    </button>
    <button class="icon" aria-label="Suivant" title={platform.tip("Suivant", "forward")} disabled={!tab?.canGoForward} onclick={() => tab && api.tabs.forward(tab.id)}>
      <Icon name="forward" />
    </button>
    {#if tab?.isLoading}
      <button class="icon" aria-label="Arrêter" title="Arrêter le chargement" onclick={() => tab && api.tabs.stop(tab.id)}><Icon name="stop" /></button>
    {:else}
      <button class="icon" aria-label="Actualiser" title={platform.tip("Actualiser", "reload")} disabled={!tab?.url} onclick={() => tab && api.tabs.reload(tab.id)}>
        <Icon name="reload" />
      </button>
    {/if}
    <div class="spacer"></div>
    <button
      class="icon"
      class:on={browser.splitTabs.length > 1}
      aria-label={browser.splitTabs.length > 1 ? "Quitter la vue scindée" : "Vue scindée"}
      title={platform.tip(browser.splitTabs.length > 1 ? "Quitter la vue scindée" : "Vue scindée : afficher deux onglets côte à côte", "toggle-split")}
      onclick={() => api.commands.run("toggle-split")}
    >
      <Icon name="split" />
    </button>
    <button
      class="icon"
      aria-label="Palette de commandes"
      title={platform.tip("Palette de commandes : onglets, pages et actions", "command-palette")}
      onclick={() => api.commands.run("command-palette")}
    >
      <Icon name="command" />
    </button>
  </nav>

  <AddressBar bind:this={addressBar} />

  <div class="space-area">
    {#key browser.state.activeSpaceId}
      <div class="space-content" in:fly={{ x: direction * 36, duration: 240, easing: cubicOut, opacity: 0 }}>
        {#if browser.activeSpace && browser.state.spaces.length > 1}
          <div class="space-title" style:--dot={browser.activeSpace.color ?? "var(--accent)"}>
            <span class="space-icon"><Icon name={browser.activeSpace.icon} size={16} /></span>
            <span class="space-name">{browser.activeSpace.name}</span>
            {#if browser.activeSpace.isolated}<span class="badge" title="Cookies et connexions séparés">Isolé</span>{/if}
            <button class="icon small" aria-label="Modifier l'espace" title="Modifier l'espace" onclick={() => (editing = browser.state.activeSpaceId)}>
              <Icon name="more" />
            </button>
          </div>
        {/if}

        {#if browser.pinnedTabs.length}
          <div class="pinned" role="tablist" aria-label="Onglets épinglés">
            {#each browser.pinnedTabs as pinned (pinned.id)}
              <button
                class="pinned-tab"
                class:active={pinned.id === browser.state.activeTabId}
                class:asleep={pinned.isAsleep}
                role="tab"
                aria-selected={pinned.id === browser.state.activeTabId}
                title={pinned.url && pinned.url !== pinned.title ? `${pinned.title}\n${displayUrl(pinned.url)}` : pinned.title}
                onclick={() => api.tabs.activate(pinned.id)}
                ondblclick={() => api.tabs.togglePin(pinned.id)}
                oncontextmenu={(event) => (event.preventDefault(), api.tabs.contextMenu(pinned.id))}
              >
                <TabIcon tab={pinned} />
              </button>
            {/each}
          </div>
        {/if}

        <div class="divider"></div>

        <button class="new-tab" title={platform.tip("Nouvel onglet", "new-tab")} onclick={newTab}>
          <Icon name="plus" size={16} /> Nouvel onglet
        </button>

        <div
          class="tabs"
          role="tablist"
          aria-label="Onglets"
          aria-orientation="vertical"
          tabindex="-1"
          bind:this={tabList}
          onkeydown={onTabsKeydown}
        >
          {#each entries as entry (entry.key)}
            {#if "split" in entry}
              <SplitGroup tabs={entry.split} {focusId} />
            {:else}
              <TabItem tab={entry.tab} active={entry.tab.id === browser.state.activeTabId} focusable={entry.tab.id === focusId} />
            {/if}
          {/each}
        </div>
      </div>
    {/key}
  </div>

  {#if editedSpace}
    <SpaceEditor space={editedSpace} onClose={() => (editing = null)} />
  {/if}
  <footer class="footer">
    {#if browser.isPrivate}
      <!-- One ephemeral space per private window: no switcher (ADR-014). -->
      <p class="private-hint" title="Cookies, cache et données de sites sont effacés à la fermeture de la fenêtre">
        Effacée à la fermeture
      </p>
    {:else}
      <SpaceSwitcher onEdit={(id) => (editing = editing === id ? null : id)} />
    {/if}
    <DownloadsButton />
    <button class="icon" aria-label="Paramètres" title={platform.tip("Paramètres", "open-settings")} onclick={() => api.settings.open()}>
      <Icon name="settings" />
    </button>
  </footer>
</aside>

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--sidebar-gap);
    /* Never more than 45% of the window, whatever the saved width. */
    width: min(var(--sidebar-width), 45vw);
    height: 100%;
    padding: 0 8px 8px;
  }
  .titlebar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    height: 40px;
    margin-right: -4px;
  }
  .titlebar.mac {
    padding-left: 72px;
  }
  .spacer {
    flex: 1;
  }
  .nav {
    display: flex;
    gap: 2px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: var(--icon-button);
    height: var(--icon-button);
    border-radius: 8px;
    color: var(--text-muted);
  }
  .icon.on {
    color: var(--accent-text);
  }
  .icon:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }
  .icon:disabled {
    opacity: 0.35;
  }
  /* Tiles share the row: few pinned tabs fill it, many wrap onto more rows. */
  .pinned {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(44px, 1fr));
    gap: 6px;
    margin-top: 6px;
  }
  .pinned-tab {
    display: grid;
    place-items: center;
    height: 44px;
    border-radius: var(--radius);
    background: var(--surface);
  }
  .pinned-tab:hover {
    background: var(--surface-hover);
  }
  .pinned-tab.active {
    background: var(--bg-elevated);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent);
  }
  /* Asleep (page unloaded, reloads on click): dimmed, like in the tab list. */
  .pinned-tab.asleep:not(.active) > :global(*) {
    opacity: 0.45;
    filter: grayscale(0.6);
  }
  .private-badge {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-left: 6px;
    padding: 4px 10px 4px 8px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--accent) 22%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent);
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  .private-hint {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding-left: 6px;
    overflow: hidden;
    color: var(--text-faint);
    font-size: 11.5px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .divider {
    height: 1px;
    margin: 6px 4px;
    background: var(--border);
  }
  .new-tab {
    display: flex;
    align-items: center;
    gap: 10px;
    height: calc(var(--tab-height) - 2px);
    padding: 0 11px;
    border-radius: var(--radius);
    color: var(--text-muted);
  }
  .new-tab:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  /* One column as wide as the sidebar: a long tab title must ellipsize, never widen (and shift) the area. */
  .space-area {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .space-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
  }
  .space-title {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    margin-top: 4px;
    padding: 0 2px 0 8px;
  }
  .space-icon {
    display: grid;
    place-items: center;
    color: color-mix(in oklab, var(--dot) 70%, var(--text));
  }
  .space-name {
    flex: 1;
    overflow: hidden;
    color: color-mix(in oklab, var(--dot) 55%, var(--text));
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .badge {
    padding: 1px 6px;
    border-radius: 6px;
    background: color-mix(in oklab, var(--dot) 18%, transparent);
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .icon.small {
    width: 26px;
    height: 26px;
  }
  /*
   * Rows keep their height and the list scrolls (never squeezes). The 2px padding keeps the
   * active tab's ring and shadow inside the scroll box; the gutter stays reserved so the rows do
   * not shift when the scrollbar appears.
   */
  .tabs {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    margin: 0 -2px;
    padding: 2px;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .tabs > :global(*) {
    flex: none;
  }
  .tabs:focus-visible {
    outline-offset: -2px;
  }
  .footer {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    margin-top: auto;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
</style>
