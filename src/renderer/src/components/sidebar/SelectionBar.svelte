<script lang="ts">
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
  <div class="selection" role="toolbar" aria-label="Onglets sélectionnés" data-testid="tab-selection">
    <span class="selection-count">{count} sélectionné{count > 1 ? "s" : ""}</span>
    <IconButton size="sm" icon="folder-plus" label="Nouveau dossier avec les onglets sélectionnés" onclick={() => selection.toFolder()} />
    {#each otherSpaces as space (space.id)}
      <IconButton size="sm" icon={space.icon} label="Déplacer vers {space.name}" onclick={() => selection.moveTo(space.id)} />
    {/each}
    {#if count >= 2 && settings.current.assistant.enabled}
      <IconButton size="sm" icon="sparkles" label="Comparer avec l'assistant" onclick={() => assistantPanel.compareTabs(selection.ids.slice(0, 6))} />
    {/if}
    <IconButton size="sm" icon="trash" label="Fermer les onglets sélectionnés" onclick={() => selection.close()} />
    <IconButton size="sm" icon="close" label="Annuler la sélection" onclick={() => selection.clear()} />
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
