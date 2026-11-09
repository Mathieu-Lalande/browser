<script lang="ts">
  import { t } from "@shared/i18n";
  import { assistantPanel } from "../../lib/assistant.svelte";
  import { browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import type { TabSelection } from "../../lib/tab-selection.svelte";
  import IconButton from "../ui/IconButton.svelte";

  /** Actions on the tabs selected with Ctrl/Cmd+click (ADR-033): new folder, move to a space, close. */
  let { selection }: { selection: TabSelection } = $props();

  const count = $derived(selection.ids.length);
  const otherSpaces = $derived(browser.isPrivate ? [] : browser.state.spaces.filter((space) => space.id !== browser.state.activeSpaceId));
</script>

{#if count}
  <div class="selection" role="toolbar" aria-label={t("selectionBar.selectedTabs")} data-testid="tab-selection">
    <span class="selection-count">{t("selectionBar.selected", { count })}</span>
    <IconButton size="sm" icon="folder-plus" label={t("selectionBar.newFolderSelectedTabs")} onclick={() => selection.toFolder()} />
    {#each otherSpaces as space (space.id)}
      <IconButton size="sm" icon={space.icon} label={t("selectionBar.move", { name: space.name })} onclick={() => selection.moveTo(space.id)} />
    {/each}
    {#if count >= 2 && settings.current.assistant.enabled}
      <IconButton size="sm" icon="sparkles" label={t("selectionBar.compareAssistant")} onclick={() => assistantPanel.compareTabs(selection.ids.slice(0, 6))} />
    {/if}
    <IconButton size="sm" icon="trash" label={t("selectionBar.closeSelectedTabs")} onclick={() => selection.close()} />
    <IconButton size="sm" icon="close" label={t("selectionBar.cancelSelection")} onclick={() => selection.clear()} />
  </div>
{/if}

<style>
  .selection {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    margin: 0 0 4px;
    padding: 2px 2px 2px 10px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 600;
  }
  .selection-count {
    flex: 1;
    min-width: 0;
  }
</style>
