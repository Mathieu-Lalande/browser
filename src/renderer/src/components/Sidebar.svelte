<script lang="ts">
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";
  import type { SpaceId, TabState } from "@shared/types";
  import { api, browser } from "../lib/browser.svelte";
  import AddressBar from "./AddressBar.svelte";
  import { settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";
  import TabIcon from "./TabIcon.svelte";
  import TabItem from "./TabItem.svelte";
  import WindowControls from "./WindowControls.svelte";
  import SpaceEditor from "./spaces/SpaceEditor.svelte";
  import SpaceSwitcher from "./spaces/SpaceSwitcher.svelte";
  import SplitGroup from "./split/SplitGroup.svelte";

  let { onToggle }: { onToggle: () => void } = $props();
  let addressBar: AddressBar;

  const tab = $derived(browser.activeTab);
  const isMac = window.platform === "darwin";
  // macOS traffic lights sit at the window's top-left: only a left sidebar makes room for them.
  const roomForTrafficLights = $derived(isMac && settings.current.layout.sidebarPosition === "left");
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

  /** Regular tabs, with the tabs of a split gathered in one entry at the place of its first tab. */
  type Entry = { key: string; tab: TabState } | { key: string; split: TabState[] };
  const entries = $derived.by((): Entry[] => {
    const splitIds = new Set(browser.state.split?.tabIds ?? []);
    const members = browser.regularTabs.filter((item) => splitIds.has(item.id));
    const list: Entry[] = [];
    for (const item of browser.regularTabs) {
      if (!splitIds.has(item.id) || members.length < 2) list.push({ key: item.id, tab: item });
      else if (item === members[0]) list.push({ key: `split-${item.id}`, split: members });
    }
    return list;
  });
</script>

<aside class="sidebar">
  <header class="titlebar drag" class:mac={roomForTrafficLights}>
    {#if !isMac}<WindowControls />{/if}
    {#if browser.isPrivate}
      <div class="private-badge" title="Navigation privée : ni historique, ni cookies conservés après la fermeture de la fenêtre">
        <Icon name="mask" size={15} />
        <span>Navigation privée</span>
      </div>
    {/if}
    <div class="spacer"></div>
    <button class="icon no-drag" aria-label="Masquer la barre latérale" title="Masquer la barre latérale (Ctrl+S)" onclick={onToggle}>
      <Icon name="sidebar" />
    </button>
  </header>

  <nav class="nav">
    <button class="icon" aria-label="Précédent" disabled={!tab?.canGoBack} onclick={() => tab && api.tabs.back(tab.id)}>
      <Icon name="back" />
    </button>
    <button class="icon" aria-label="Suivant" disabled={!tab?.canGoForward} onclick={() => tab && api.tabs.forward(tab.id)}>
      <Icon name="forward" />
    </button>
    {#if tab?.isLoading}
      <button class="icon" aria-label="Arrêter" onclick={() => tab && api.tabs.stop(tab.id)}><Icon name="stop" /></button>
    {:else}
      <button class="icon" aria-label="Actualiser" disabled={!tab?.url} onclick={() => tab && api.tabs.reload(tab.id)}>
        <Icon name="reload" />
      </button>
    {/if}
  </nav>

  <AddressBar bind:this={addressBar} />

  <div class="space-area">
    {#key browser.state.activeSpaceId}
      <div class="space-content" in:fly={{ x: direction * 36, duration: 240, easing: cubicOut, opacity: 0 }}>
        {#if browser.activeSpace && browser.state.spaces.length > 1}
          <div class="space-title" style:--dot={browser.activeSpace.color ?? "var(--accent)"}>
            <span class="space-icon">{browser.activeSpace.icon}</span>
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
                title={pinned.title}
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

        <button class="new-tab" onclick={() => (api.tabs.create(), focusAddress())}>
          <Icon name="plus" size={14} /> Nouvel onglet
        </button>

        <div class="tabs" role="tablist" aria-label="Onglets" aria-orientation="vertical">
          {#each entries as entry (entry.key)}
            {#if "split" in entry}
              <SplitGroup tabs={entry.split} />
            {:else}
              <TabItem tab={entry.tab} active={entry.tab.id === browser.state.activeTabId} />
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
    <button class="icon" aria-label="Paramètres" title="Paramètres (Ctrl+,)" onclick={() => api.settings.open()}>
      <Icon name="settings" />
    </button>
    <button
      class="icon"
      class:on={zen}
      aria-label="Mode zen"
      aria-pressed={zen}
      title="Mode zen (Ctrl+Maj+B)"
      onclick={() => settings.update({ layout: { zenMode: !zen } })}
    >
      <Icon name="zen" />
    </button>
  </footer>
</aside>

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--sidebar-gap);
    width: var(--sidebar-width);
    height: 100%;
    padding: 0 8px 8px;
  }
  .titlebar {
    display: flex;
    align-items: center;
    height: 40px;
    flex: none;
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
  .pinned {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
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
  .space-area {
    display: grid;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .space-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
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
    font-size: 14px;
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
  .tabs {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    overflow-y: auto;
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
