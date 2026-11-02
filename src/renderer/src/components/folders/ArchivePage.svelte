<script lang="ts">
  import ListRow from "../ui/ListRow.svelte";
  import Card from "../ui/Card.svelte";
  import type { ArchivedTab } from "@shared/archive";
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Favicon from "../Favicon.svelte";
  import Button from "../ui/Button.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Page from "../ui/Page.svelte";
  import SearchField from "../ui/SearchField.svelte";

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

{#snippet subtitle()}
  {#if delay === "never"}
    L'archivage automatique est désactivé (Paramètres, Comportement).
  {:else}
    Les onglets laissés de côté plus de {delayLabel[delay]} sont fermés et rangés ici. Les onglets épinglés, les favoris, les onglets qui
    jouent du son et ceux d'une vue scindée ne sont jamais archivés.
  {/if}
{/snippet}

<Page icon="archive" title="Onglets archivés" {subtitle} testid="archive-page">
  {#snippet actions()}
    {#if !browser.isPrivate}
      <Button icon="list-x" disabled={!entries.length || query !== ""} onclick={() => api.archive.clear()}>Tout supprimer</Button>
    {/if}
  {/snippet}

  <SearchField bind:value={query} label="Rechercher dans les onglets archivés" />

  {#if entries.length}
    <Card as="ul">
      {#each entries as entry (entry.id)}
        <ListRow dense data-archive-id={entry.id}>
          <Favicon src={entry.favicon} />
          <span class="text">
            <span class="title">{entry.title}</span>
            <span class="detail">{displayUrl(entry.url)} · archivé le {dateFormat.format(entry.archivedAt)}</span>
          </span>
          <Button size="sm" icon="archive-restore" title="Rouvrir l'onglet" onclick={() => api.archive.restore(entry.id)}>Restaurer</Button>
          {#if !browser.isPrivate}
            <IconButton size="row" icon="trash" iconSize={16} label={`Supprimer ${entry.title}`} title="Supprimer de l'archive" onclick={() => api.archive.remove(entry.id)} />
          {/if}
        </ListRow>
      {/each}
    </Card>
  {:else if query}
    <EmptyState icon="search" title="Aucun résultat" hint="Aucun onglet archivé ne correspond à cette recherche." />
  {:else}
    <EmptyState icon="archive" title="Aucun onglet archivé pour l'instant" hint="Les onglets inactifs depuis longtemps viendront se ranger ici, prêts à être rouverts." />
  {/if}
</Page>

<style>
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
    font-size: var(--text-xs);
  }
</style>
