<script lang="ts">
  import { internalFragment, internalUrl } from "@shared/internal";
  import { readingTimeLabel } from "@shared/reader";
  import type { ReadingEntry } from "@shared/reading-list";
  import { api, browser } from "../../lib/browser.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import ListRow from "../ui/ListRow.svelte";
  import Page from "../ui/Page.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import ReadingArticle from "./ReadingArticle.svelte";

  /**
   * `browser://reading-list` (ADR-047): the pages saved with "Lire plus tard", unread first, each
   * with its offline copy of the reader-mode text (`#<id>` shows it, without the network).
   */

  type Filter = "unread" | "all" | "read";
  let filter = $state<Filter>("unread");
  let entries = $state<ReadingEntry[]>([]);

  async function refresh(): Promise<void> {
    entries = await api.reading.list().catch(() => []);
  }
  $effect(() => {
    void refresh();
    return api.reading.onChanged(() => void refresh());
  });

  /** The offline article shown (`browser://reading-list#<id>`). */
  const openId = $derived(internalFragment(browser.activeTab?.url ?? ""));
  const shown = $derived(entries.filter((entry) => (filter === "all" ? true : filter === "read" ? entry.readAt !== null : entry.readAt === null)));
  const unread = $derived(entries.filter((entry) => entry.readAt === null).length);

  const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });

  function go(url: string): void {
    const tab = browser.activeTab;
    if (tab) api.tabs.navigate(tab.id, url);
  }

  /** Reads the offline copy here (the item counts as read). */
  function read(entry: ReadingEntry): void {
    if (entry.readAt === null) api.reading.setRead(entry.id, true);
    go(internalUrl("reading-list", entry.id));
  }

  /** The live page, in a new tab (marked read too). */
  function openPage(entry: ReadingEntry): void {
    if (entry.readAt === null) api.reading.setRead(entry.id, true);
    api.tabs.create(entry.url);
  }
</script>

{#if openId}
  <ReadingArticle id={openId} onBack={() => go(internalUrl("reading-list"))} />
{:else}
  <Page
    icon="book-marked"
    title="Liste de lecture"
    subtitle={browser.isPrivate
      ? "La liste de lecture n'est pas disponible en navigation privée."
      : "Les pages gardées pour plus tard, avec leur texte lisible hors ligne. Synchronisée avec vos appareils quand la synchronisation est active."}
    testid="reading-list-page"
  >
    {#snippet actions()}
      <Segmented
        label="Afficher"
        value={filter}
        options={[
          { value: "unread" as Filter, label: `Non lues (${unread})` },
          { value: "all" as Filter, label: "Toutes" },
          { value: "read" as Filter, label: "Lues" },
        ]}
        onchange={(next) => (filter = next)}
      />
    {/snippet}

    {#if shown.length}
      <Card as="ul">
        {#each shown as entry (entry.id)}
          <ListRow align="start" data-reading-id={entry.id} class={entry.readAt === null ? "unread" : "read"}>
            <span class="text">
              <button type="button" class="title" onclick={() => (entry.offline ? read(entry) : openPage(entry))}>{entry.title}</button>
              <span class="detail">
                {entry.siteName || entry.url} · ajoutée le {dateFormat.format(entry.addedAt)}{#if entry.minutes}
                  · {readingTimeLabel(entry.minutes)}{/if}{#if entry.offline}
                  · <span class="offline">hors ligne</span>{/if}
              </span>
              {#if entry.excerpt}<span class="excerpt">{entry.excerpt}</span>{/if}
            </span>
            {#if entry.offline}
              <Button size="sm" icon="reader" title="Lire le texte enregistré, sans connexion" onclick={() => read(entry)}>Lire</Button>
            {/if}
            <IconButton size="row" icon="open" iconSize={16} label={`Ouvrir ${entry.title}`} title="Ouvrir la page dans un nouvel onglet" onclick={() => openPage(entry)} />
            <IconButton
              size="row"
              icon={entry.readAt === null ? "check" : "reset"}
              iconSize={16}
              label={entry.readAt === null ? `Marquer ${entry.title} comme lue` : `Marquer ${entry.title} comme non lue`}
              onclick={() => api.reading.setRead(entry.id, entry.readAt === null)}
            />
            <IconButton size="row" icon="trash" iconSize={16} label={`Retirer ${entry.title}`} title="Retirer de la liste" onclick={() => api.reading.remove(entry.id)} />
          </ListRow>
        {/each}
      </Card>
    {:else if entries.length}
      <EmptyState icon="check" title={filter === "unread" ? "Tout est lu" : "Rien ici"} hint="Changez de filtre pour retrouver les autres pages." />
    {:else}
      <EmptyState
        icon="book-marked"
        title="Aucune page à lire plus tard"
        hint="« Lire plus tard » (barre d'adresse, menu de la page ou Ctrl+Maj+D) garde une page et son texte, lisible même hors ligne."
      />
    {/if}
  </Page>
{/if}

<style>
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .title {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    text-align: start;
    cursor: pointer;
  }
  :global(.read) .title {
    font-weight: 400;
    color: var(--text-muted);
  }
  .title:hover {
    text-decoration: underline;
  }
  .detail,
  .excerpt {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .excerpt {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .offline {
    color: var(--accent-text);
  }
</style>
