<script lang="ts">
  import type { ArchivedTab } from "@shared/archive";
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Favicon from "../Favicon.svelte";
  import Icon from "../Icon.svelte";

  /**
   * `browser://archive` (ADR-022): tabs closed by auto-archiving, searchable, to restore or delete.
   * In a private window the list is read-only (restoring opens the page, the entry stays).
   */

  let query = $state("");
  let entries = $state<ArchivedTab[]>([]);
  let request = 0;

  async function refresh(): Promise<void> {
    const id = ++request;
    const list = await api.archive.list(query).catch(() => []);
    if (id === request) entries = list;
  }

  $effect(() => {
    void query;
    void refresh();
  });
  $effect(() => api.archive.onChanged(() => void refresh()));

  const delay = $derived(settings.current.behavior.archiveTabsAfter);
  const delayLabel: Record<string, string> = { "12h": "12 heures", "24h": "24 heures", "7d": "7 jours", "30d": "30 jours" };

  const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
</script>

<div class="page" data-testid="archive-page">
  <div class="inner">
    <header>
      <span class="badge"><Icon name="archive" size={20} /></span>
      <h1>Onglets archivés</h1>
      {#if !browser.isPrivate}
        <button class="clear" disabled={!entries.length || query !== ""} onclick={() => api.archive.clear()}>
          <Icon name="list-x" size={12} /> Tout supprimer
        </button>
      {/if}
    </header>

    <p class="intro">
      {#if delay === "never"}
        L'archivage automatique est désactivé (Paramètres, Comportement).
      {:else}
        Les onglets laissés de côté plus de {delayLabel[delay]} sont fermés et rangés ici. Les onglets épinglés, les favoris, les onglets qui
        jouent du son et ceux d'une vue scindée ne sont jamais archivés.
      {/if}
    </p>

    <label class="search">
      <Icon name="search" size={16} />
      <input bind:value={query} placeholder="Rechercher dans les onglets archivés" aria-label="Rechercher dans les onglets archivés" spellcheck="false" />
    </label>

    {#if entries.length}
      <ul class="card">
        {#each entries as entry (entry.id)}
          <li class="row" data-archive-id={entry.id}>
            <Favicon src={entry.favicon} />
            <span class="text">
              <span class="title">{entry.title}</span>
              <span class="detail">{displayUrl(entry.url)} · archivé le {dateFormat.format(entry.archivedAt)}</span>
            </span>
            <button class="action" onclick={() => api.archive.restore(entry.id)} title="Rouvrir l'onglet">
              <Icon name="archive-restore" size={12} /> Restaurer
            </button>
            {#if !browser.isPrivate}
              <button class="action icon-only" aria-label={`Supprimer ${entry.title}`} title="Supprimer de l'archive" onclick={() => api.archive.remove(entry.id)}>
                <Icon name="trash" size={12} />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">{query ? "Aucun onglet archivé ne correspond à cette recherche." : "Aucun onglet archivé pour l'instant."}</p>
    {/if}
  </div>
</div>

<style>
  .page {
    height: 100%;
    overflow-y: auto;
    animation: rise 0.3s var(--ease);
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 760px;
    margin: 0 auto;
    padding: 36px 32px 64px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 11px;
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--accent-text);
  }
  h1 {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    white-space: nowrap;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.03em;
  }
  .intro {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .clear,
  .action {
    display: flex;
    flex: none;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    white-space: nowrap;
  }
  .clear {
    margin-left: auto;
  }
  .clear:hover:not(:disabled),
  .action:hover {
    background: var(--surface-hover);
  }
  .clear:disabled {
    opacity: 0.45;
  }
  .icon-only {
    width: 30px;
    padding: 0;
    justify-content: center;
    color: var(--text-muted);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 38px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text-faint);
  }
  .search:focus-within {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    user-select: text;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 2px);
    background: var(--bg-elevated);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: var(--radius);
  }
  .row:hover {
    background: var(--surface-hover);
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .title,
  .detail {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .detail {
    color: var(--text-muted);
    font-size: 12px;
  }
  .empty {
    margin: 0;
    padding: 48px 0 8px;
    color: var(--text-muted);
    text-align: center;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
