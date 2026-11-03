<script lang="ts">
  import type { SpaceInfo, SpacePeek } from "@shared/types";
  import { peekRows } from "../../lib/tab-tree";
  import TabItem from "../TabItem.svelte";
  import FolderLabel from "./FolderLabel.svelte";
  import SpaceHeader from "./SpaceHeader.svelte";
  import TreeRow from "./TreeRow.svelte";

  /** A neighbour space beside the shown one during a swipe: a still picture of its sidebar (inert). */
  let { space, peek, side }: { space: SpaceInfo; peek: SpacePeek | undefined; side: "previous" | "next" } = $props();

  const pinned = $derived(peek?.tabs.filter((item) => item.isPinned) ?? []);
  const rows = $derived(peek ? peekRows(peek) : []);
</script>

<div class="space-content peek {side}" inert aria-hidden="true" data-peek={side}>
  <SpaceHeader {space} {pinned} activeId={peek?.activeTabId ?? null} preview />
  <div class="tabs">
    {#each rows as entry (entry.key)}
      <TreeRow depth={entry.depth} folder={"folder" in entry}>
        {#if "folder" in entry}
          <FolderLabel row={entry.folder} />
        {:else}
          <TabItem tab={entry.tab} active={entry.tab.id === peek?.activeTabId} focusable={false} />
        {/if}
      </TreeRow>
    {/each}
  </div>
</div>

<style>
  .space-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
  }
  .peek {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 100%;
    overflow: hidden;
    pointer-events: none;
  }
  .peek.previous {
    right: calc(100% + var(--peek-gap));
  }
  .peek.next {
    left: calc(100% + var(--peek-gap));
  }
  /* Same box as the tab list (see TabTree), without scrolling. */
  .tabs {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    margin: 0 -2px;
    padding: 2px;
    overflow: hidden;
    scrollbar-gutter: stable;
  }
  .tabs > :global(*) {
    flex: none;
  }
</style>
