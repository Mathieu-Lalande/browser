<script lang="ts">
  import type { Bookmark } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { api } from "../../lib/browser.svelte";
  import Favicon from "../Favicon.svelte";
  import Icon from "../Icon.svelte";
  import Row from "./Row.svelte";

  let bookmarks = $state<Bookmark[]>([]);
  /** Clearing history asks for a second click. */
  let confirming = $state(false);
  let cleared = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  const refresh = () => api.bookmarks.list().then((list) => (bookmarks = list), () => {});

  $effect(() => {
    void refresh();
    return () => clearTimeout(confirmTimer);
  });

  async function clearHistory(): Promise<void> {
    if (!confirming) {
      confirming = true;
      cleared = false;
      confirmTimer = setTimeout(() => (confirming = false), 4000);
      return;
    }
    clearTimeout(confirmTimer);
    confirming = false;
    await api.history.clear().catch(() => {});
    cleared = true;
  }

  async function remove(id: string): Promise<void> {
    await api.bookmarks.remove(id).catch(() => {});
    await refresh();
  }
</script>

<Row label="Historique de navigation" hint="Efface toutes les pages visitées, et les suggestions qui en découlent.">
  {#if cleared}<span class="done"><Icon name="check" size={12} /> Historique effacé</span>{/if}
  <button class="danger" class:confirming onclick={clearHistory}>
    <Icon name="trash" size={12} />
    {confirming ? "Confirmer l'effacement" : "Effacer l'historique"}
  </button>
</Row>

<Row label="Favoris" hint={bookmarks.length ? `${bookmarks.length} page${bookmarks.length > 1 ? "s" : ""} en favori.` : "Aucun favori pour l'instant : Ctrl+D ajoute la page affichée."} stacked={bookmarks.length > 0}>
  {#if bookmarks.length}
    <ul class="bookmarks" aria-label="Favoris">
      {#each bookmarks as bookmark (bookmark.id)}
        <li>
          <Favicon src={bookmark.favicon} />
          <span class="text">
            <span class="title">{bookmark.title}</span>
            <span class="url">{displayUrl(bookmark.url)}</span>
          </span>
          <button class="remove" aria-label="Retirer {bookmark.title} des favoris" title="Retirer des favoris" onclick={() => remove(bookmark.id)}>
            <Icon name="close" size={12} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Row>

<style>
  .danger {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    transition: background 0.15s var(--ease);
  }
  .danger:hover {
    background: var(--surface-hover);
  }
  .danger.confirming {
    border-color: transparent;
    background: #e5484d;
    color: #fff;
  }
  .done {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .bookmarks {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    max-height: 280px;
    margin: 0;
    padding: 4px;
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 38px;
    padding: 4px 6px 4px 10px;
    border-radius: 7px;
  }
  li:hover {
    background: var(--surface-hover);
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .title,
  .url {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .url {
    color: var(--text-faint);
    font-size: 11px;
  }
  .remove {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-faint);
    opacity: 0;
  }
  li:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }
  .remove:hover {
    background: var(--surface-active);
    color: var(--text);
  }
</style>
