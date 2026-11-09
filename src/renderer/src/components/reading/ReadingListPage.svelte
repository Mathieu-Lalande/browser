<script lang="ts">
  import { t, intlLocale } from "@shared/i18n";
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

  const dateFormat = new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "long" });

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
    title={t("readingListPage.readingList")}
    subtitle={browser.isPrivate
      ? t("readingListPage.readingListIsntAvailable")
      : t("readingListPage.pagesKeptLaterTheir")}
    testid="reading-list-page"
  >
    {#snippet actions()}
      <Segmented
        label={t("readingListPage.show")}
        value={filter}
        options={[
          { value: "unread" as Filter, label: t("readingListPage.unread", { unread }) },
          { value: "all" as Filter, label: t("readingListPage.all") },
          { value: "read" as Filter, label: t("readingListPage.read") },
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
                {t("readingListPage.added", { p: entry.siteName || entry.url, p2: dateFormat.format(entry.addedAt) })}{#if entry.minutes}
                  · {readingTimeLabel(entry.minutes)}{/if}{#if entry.offline}
                  · <span class="offline">{t("readingListPage.offline")}</span>{/if}
              </span>
              {#if entry.excerpt}<span class="excerpt">{entry.excerpt}</span>{/if}
            </span>
            {#if entry.offline}
              <Button size="sm" icon="reader" title={t("readingListPage.readSavedTextWithout")} onclick={() => read(entry)}>{t("readingListPage.read2")}</Button>
            {/if}
            <IconButton size="row" icon="open" iconSize={16} label={t("readingListPage.open", { title: entry.title })} title={t("readingListPage.openPageNewTab")} onclick={() => openPage(entry)} />
            <IconButton
              size="row"
              icon={entry.readAt === null ? "check" : "reset"}
              iconSize={16}
              label={entry.readAt === null ? `Marquer ${entry.title} comme lue` : t("readingListPage.markUnread", { title: entry.title })}
              onclick={() => api.reading.setRead(entry.id, entry.readAt === null)}
            />
            <IconButton size="row" icon="trash" iconSize={16} label={t("readingListPage.remove", { title: entry.title })} title={t("readingListPage.removeFromList")} onclick={() => api.reading.remove(entry.id)} />
          </ListRow>
        {/each}
      </Card>
    {:else if entries.length}
      <EmptyState icon="check" title={filter === "unread" ? t("readingListPage.allRead") : t("readingListPage.nothingHere")} hint={t("readingListPage.changeFilterFindOther")} />
    {:else}
      <EmptyState
        icon="book-marked"
        title={t("readingListPage.noPagesReadLater")}
        hint={t("readingListPage.readLaterAddressBar")}
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
