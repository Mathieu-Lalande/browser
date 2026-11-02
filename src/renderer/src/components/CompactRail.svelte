<script lang="ts">
  import { api, browser } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import Icon from "./Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import TabIcon from "./TabIcon.svelte";
  import MediaRailButton from "./media/MediaRailButton.svelte";

  /**
   * Compact mode (ADR-033): the sidebar folded to a rail of tab icons. Hovering it unfolds the
   * whole sidebar (App), so this only has to be glanceable and clickable: the space, new tab,
   * pinned then regular tabs.
   */
  const tabs = $derived([...browser.pinnedTabs, ...browser.regularTabs]);

  function onContextMenu(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest("[data-tab-id]")) return;
    event.preventDefault();
    api.sidebar.contextMenu();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav class="rail" aria-label="Barre latérale compacte" data-testid="compact-rail" oncontextmenu={onContextMenu}>
  {#if browser.activeSpace}
    <span class="space" style:--dot={browser.activeSpace.color ?? "var(--accent)"} title={browser.activeSpace.name}>
      <Icon name={browser.activeSpace.icon} size={16} />
    </span>
  {/if}
  <IconButton icon="plus" label="Nouvel onglet" command="new-tab" onclick={() => api.commands.run("new-tab")} />
  <div class="divider"></div>
  <div class="tabs" role="tablist" aria-orientation="vertical" aria-label="Onglets">
    {#each tabs as tab (tab.id)}
      <button
        class="tab"
        class:active={tab.id === browser.state.activeTabId}
        class:asleep={tab.isAsleep}
        role="tab"
        aria-selected={tab.id === browser.state.activeTabId}
        aria-label={tab.title}
        title={tab.title}
        data-tab-id={tab.id}
        onclick={() => api.tabs.activate(tab.id)}
        oncontextmenu={(event) => (event.preventDefault(), api.tabs.contextMenu(tab.id))}
      >
        <TabIcon {tab} />
      </button>
    {/each}
  </div>
  <MediaRailButton />
  <IconButton icon="settings" label="Paramètres" title={platform.tip("Paramètres", "open-settings")} onclick={() => api.settings.open()} />
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 52px;
    height: 100%;
    padding: 10px 0 8px;
  }
  .space {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--dot) 18%, transparent);
    color: var(--dot);
  }
  .divider {
    width: 24px;
    height: 1px;
    margin: 2px 0;
    background: var(--border);
  }
  .tabs {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .tab {
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
  }
  .tab:hover {
    background: var(--surface-hover);
  }
  .tab.active {
    background: var(--surface-active);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .tab.asleep {
    opacity: 0.55;
  }
</style>
