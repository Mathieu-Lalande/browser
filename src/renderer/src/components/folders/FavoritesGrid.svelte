<script lang="ts">
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Favicon from "../Favicon.svelte";
  import Icon from "../Icon.svelte";

  /**
   * Favorites grid at the top of the sidebar (ADR-022), shared by every space. A tile opens its
   * site's tab (or a new one); a dot marks tiles with a tab open in this window. `dropping`: a tab
   * is being dragged over the grid (the sidebar handles the drag).
   */
  let { dropping = false, dragActive = false }: { dropping?: boolean; dragActive?: boolean } = $props();

  const favorites = $derived(browser.state.favorites ?? []);
  const activeUrl = $derived(browser.activeTab?.url ?? "");
  /** Empty grid: a dismissible drop zone says it exists and is shared by every space. */
  const showHint = $derived(!favorites.length && !browser.isPrivate && !settings.current.layout.favoritesHintDismissed);
</script>

{#if favorites.length || showHint || (dragActive && !browser.isPrivate)}
  <div class="favorites" class:dropping class:floating={!favorites.length && !showHint} role="list" aria-label="Favoris" data-drop="favorites">
    {#each favorites as favorite (favorite.url)}
      <div role="listitem">
        <button
          class="tile"
          class:open={favorite.open}
          class:current={activeUrl === favorite.url}
          data-favorite-url={favorite.url}
          aria-label={`${favorite.title}${favorite.open ? " (ouvert)" : ""}`}
          title={`${favorite.title}\n${displayUrl(favorite.url)}`}
          onclick={() => api.favorites.open(favorite.url)}
          oncontextmenu={(event) => (event.preventDefault(), api.favorites.contextMenu(favorite.url))}
        >
          <Favicon src={favorite.favicon} />
          {#if favorite.open}<span class="dot" aria-hidden="true"></span>{/if}
        </button>
      </div>
    {/each}
    {#if showHint}
      <div class="empty-hint" role="listitem" data-testid="favorites-hint">
        <Icon name="star" size={16} />
        <span class="hint-text">Glissez un onglet ici pour l'épingler dans tous les espaces</span>
        <button
          class="dismiss"
          aria-label="Masquer l'astuce des favoris"
          title="Masquer"
          onclick={() => settings.update({ layout: { favoritesHintDismissed: true } })}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    {:else if dragActive && !browser.isPrivate}
      <div class="drop-hint" role="listitem">{favorites.length ? "" : "Déposez un onglet ici pour l'ajouter aux favoris"}</div>
    {/if}
  </div>
{/if}

<style>
  .favorites {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
    gap: 6px;
    padding: 2px;
    border-radius: calc(var(--radius) + 2px);
    transition: background 0.12s var(--ease);
  }
  /* No tile yet: the drop zone floats over the top of the tab list instead of pushing it down mid-drag. */
  .favorites.floating {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    z-index: 4;
    background: var(--bg-elevated);
    box-shadow: 0 8px 20px -10px rgb(0 0 0 / 0.5);
  }
  .favorites.floating.dropping {
    background: color-mix(in oklab, var(--accent) 14%, var(--bg-elevated));
  }
  .favorites.dropping {
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent-text) 50%, transparent);
  }
  .tile {
    position: relative;
    display: grid;
    width: 100%;
    height: 44px;
    place-items: center;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .tile:hover {
    background: var(--surface-hover);
  }
  .tile.current {
    background: var(--bg-elevated);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent);
  }
  /* The tile's site has a tab open in this window. */
  .dot {
    position: absolute;
    bottom: 4px;
    left: 50%;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent-text);
    transform: translateX(-50%);
  }
  .tile :global(.favicon) {
    transform: scale(1.15);
  }
  .drop-hint {
    display: grid;
    grid-column: 1 / -1;
    min-height: 32px;
    place-items: center;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font-size: 11.5px;
    text-align: center;
  }
  .empty-hint {
    display: flex;
    grid-column: 1 / -1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 40px;
    padding: 4px 4px 4px 10px;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--text-faint);
    font-size: 11.5px;
    line-height: 1.3;
  }
  .empty-hint > :global(svg) {
    flex: none;
  }
  .favorites.dropping .empty-hint {
    border-color: color-mix(in oklab, var(--accent-text) 60%, transparent);
    color: var(--text);
  }
  .hint-text {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .dismiss {
    display: grid;
    flex: none;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-faint);
  }
  .dismiss:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .favorites:has(.tile) .drop-hint {
    display: none;
  }
</style>
