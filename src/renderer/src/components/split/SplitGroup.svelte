<script lang="ts">
  import type { TabState } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import TabItem from "../TabItem.svelte";

  /** The tabs of a split, grouped in one pill in the sidebar. */
  let { tabs }: { tabs: TabState[] } = $props();

  const visible = $derived(tabs.some((tab) => tab.id === browser.state.activeTabId));
</script>

<div class="split-group" class:visible role="group" aria-label="Vue scindée">
  <div class="members" class:grid={tabs.length > 2}>
    {#each tabs as tab (tab.id)}
      <TabItem {tab} active={tab.id === browser.state.activeTabId} />
    {/each}
  </div>
  {#if visible}
    <button class="exit" aria-label="Quitter la vue scindée" title="Quitter la vue scindée (Ctrl+Maj+\)" onclick={() => api.split.exit()}>
      <Icon name="split" size={13} />
    </button>
  {/if}
</div>

<style>
  .split-group {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: calc(var(--radius) + 3px);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .split-group.visible {
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent);
  }
  .members {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px;
    min-width: 0;
  }
  .members :global(.tab) {
    gap: 7px;
    height: 32px;
    padding: 0 4px 0 8px;
  }
  .members :global(.tab .close) {
    display: none;
  }
  .exit {
    display: grid;
    flex: none;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    color: var(--text-muted);
  }
  .exit:hover {
    background: var(--surface-active);
    color: var(--text);
  }
</style>
