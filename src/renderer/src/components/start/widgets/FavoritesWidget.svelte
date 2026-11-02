<script lang="ts">
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../../../lib/browser.svelte";
  import Favicon from "../../Favicon.svelte";
  import type { WidgetProps } from "../types";

  let { widget }: WidgetProps<"favorites"> = $props();
  const favorites = $derived((browser.state.favorites ?? []).slice(0, widget.options.count));
</script>

<h2 class="widget-title">Favoris</h2>
{#if favorites.length}
  <div class="grid">
    {#each favorites as favorite (favorite.url)}
      <button class="favorite" class:open={favorite.open} title={favorite.url} onclick={() => api.favorites.open(favorite.url)}>
        <Favicon src={favorite.favicon} />
        <span>{favorite.title || displayUrl(favorite.url)}</span>
      </button>
    {/each}
  </div>
{:else}
  <p class="widget-empty">Glissez un onglet sur la grille des favoris, en haut de la barre latérale.</p>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 6px;
  }
  .favorite {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 13px;
  }
  .favorite:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .favorite.open {
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 50%, transparent);
  }
  .favorite span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
