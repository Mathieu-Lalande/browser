<script lang="ts">
  import { api, browser } from "../lib/browser.svelte";
  import AddressBar from "./AddressBar.svelte";
  import Favicon from "./Favicon.svelte";
  import Icon from "./Icon.svelte";
  import TabItem from "./TabItem.svelte";
  import WindowControls from "./WindowControls.svelte";

  let { onToggle }: { onToggle: () => void } = $props();
  let addressBar: AddressBar;

  const tab = $derived(browser.activeTab);
  const isMac = window.platform === "darwin";

  export function focusAddress(): void {
    addressBar.focus();
  }
</script>

<aside class="sidebar">
  <header class="titlebar drag" class:mac={isMac}>
    {#if !isMac}<WindowControls />{/if}
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

  {#if browser.pinnedTabs.length}
    <div class="pinned" role="tablist" aria-label="Onglets épinglés">
      {#each browser.pinnedTabs as pinned (pinned.id)}
        <button
          class="pinned-tab"
          class:active={pinned.id === browser.state.activeTabId}
          role="tab"
          aria-selected={pinned.id === browser.state.activeTabId}
          title={pinned.title}
          onclick={() => api.tabs.activate(pinned.id)}
          ondblclick={() => api.tabs.togglePin(pinned.id)}
        >
          <Favicon src={pinned.favicon} loading={pinned.isLoading} />
        </button>
      {/each}
    </div>
  {/if}

  <div class="divider"></div>

  <button class="new-tab" onclick={() => (api.tabs.create(), focusAddress())}>
    <Icon name="plus" size={14} /> Nouvel onglet
  </button>

  <div class="tabs" role="tablist" aria-label="Onglets" aria-orientation="vertical">
    {#each browser.regularTabs as item (item.id)}
      <TabItem tab={item} active={item.id === browser.state.activeTabId} />
    {/each}
  </div>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: var(--sidebar-width);
    height: 100%;
    padding: 0 8px 10px var(--gutter);
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
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--text-muted);
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
  .divider {
    height: 1px;
    margin: 6px 4px;
    background: var(--border);
  }
  .new-tab {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 11px;
    border-radius: var(--radius);
    color: var(--text-muted);
  }
  .new-tab:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .tabs {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    overflow-y: auto;
  }
</style>
