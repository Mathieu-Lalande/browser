<script lang="ts">
  import type { TabState } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import { platform } from "../../lib/platform.svelte";
  import Icon from "../Icon.svelte";
  import TabItem from "../TabItem.svelte";

  /** The tabs of a split, grouped in one pill in the sidebar. */
  /** `tabs` in pane order (split.tabIds); `focusId`: the list's single Tab stop, when it is one of them. */
  let { tabs, focusId }: { tabs: TabState[]; focusId?: string | null } = $props();

  const visible = $derived(tabs.some((tab) => tab.id === browser.state.activeTabId));
</script>

<!-- Presentational wrapper: its tabs stay direct members of the tab list for assistive tech. -->
<div class="split-group" class:visible role="none" title="Vue scindée">
  <!-- Same arrangement as the panes (SplitView, splitLayout): columns, top to bottom. -->
  <div class="members" class:three={tabs.length === 3} class:four={tabs.length === 4} role="none">
    {#each tabs as tab (tab.id)}
      <TabItem {tab} active={tab.id === browser.state.activeTabId} focusable={tab.id === focusId} />
    {/each}
  </div>
  {#if visible}
    <button
      class="exit"
      tabindex="-1"
      aria-label="Quitter la vue scindée"
      title={platform.tip("Quitter la vue scindée", "toggle-split")}
      onclick={() => api.split.exit()}
    >
      <Icon name="split" size={12} />
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
  /* 3 panes: a full-height left column, the right one split in two. 4: a 2×2 grid, column by column. */
  .members.three,
  .members.four {
    grid-template-rows: repeat(2, auto);
    grid-auto-flow: column;
  }
  .members.three > :global(:first-child) {
    grid-row: span 2;
    height: auto;
  }
  .members :global(.tab) {
    gap: 7px;
    height: 32px;
    padding: 0 4px 0 8px;
  }
  /* Half-width tabs: a smaller close button, still always reachable. */
  .members :global(.tab .close) {
    width: 18px;
    height: 18px;
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
