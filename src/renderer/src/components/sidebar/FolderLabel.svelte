<script lang="ts">
  import type { FolderRow } from "../../lib/tab-tree";
  import Icon from "../Icon.svelte";

  /** A folder row's label (chevron, icon, name, tab count): a button that folds it, or inert (`onToggle` absent). */
  let { row, onToggle }: { row: FolderRow; onToggle?: () => void } = $props();
  const folder = $derived(row.folder);
</script>

{#snippet content()}
  <span class="chevron-icon" class:open={!folder.collapsed}><Icon name="chevron-right" size={12} /></span>
  <span class="folder-icon"><Icon name={folder.icon === "folder" && !folder.collapsed ? "folder-open" : folder.icon} size={16} /></span>
  <span class="folder-name">{folder.name}</span>
  {#if row.count}<span class="count">{row.count}</span>{/if}
{/snippet}

{#if onToggle}
  <button
    class="chevron"
    aria-expanded={!folder.collapsed}
    aria-label={folder.collapsed ? `Déplier le dossier ${folder.name}` : `Replier le dossier ${folder.name}`}
    onclick={onToggle}
  >
    {@render content()}
  </button>
{:else}
  <div class="chevron">{@render content()}</div>
{/if}

<style>
  .chevron {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: calc(var(--tab-height) - 4px);
    padding: 0 6px 0 4px;
    border-radius: var(--radius);
    color: var(--text-muted);
    font-weight: 600;
  }
  .chevron:hover {
    color: var(--text);
  }
  .chevron-icon {
    display: grid;
    flex: none;
    place-items: center;
    transition: transform 0.15s var(--ease);
  }
  .chevron-icon.open {
    transform: rotate(90deg);
  }
  .folder-icon {
    display: grid;
    flex: none;
    place-items: center;
  }
  .folder-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .count {
    flex: none;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 600;
  }
</style>
