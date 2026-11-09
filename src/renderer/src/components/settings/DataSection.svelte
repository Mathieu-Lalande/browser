<script lang="ts">
  import { t } from "@shared/i18n";
  import type { Bookmark } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { api } from "../../lib/browser.svelte";
  import Favicon from "../Favicon.svelte";
  import Icon from "../Icon.svelte";
  import { platform } from "../../lib/platform.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import Row from "../ui/Row.svelte";

  let bookmarks = $state<Bookmark[]>([]);
  let cleared = $state(false);

  const refresh = () => api.bookmarks.list().then((list) => (bookmarks = list), () => {});

  $effect(() => {
    void refresh();
  });

  async function clearHistory(): Promise<void> {
    await api.history.clear().catch(() => {});
    cleared = true;
  }

  async function remove(id: string): Promise<void> {
    await api.bookmarks.remove(id).catch(() => {});
    await refresh();
  }
</script>

<Row anchor="import" label={t("dataSection.importFromAnotherBrowser")} hint={t("dataSection.bookmarksHistorySearchEngine")} keywords={t("dataSection.importChromeFirefoxEdge")}>
  <Button icon="import" onclick={() => api.commands.run("import-data")}>{t("dataSection.import")}</Button>
</Row>

<Row anchor="history" label={t("dataSection.browsingHistory")} hint={t("dataSection.clearsAllVisitedPages")}>
  <Button variant="quiet" icon="history" onclick={() => api.commands.run("open-history")}>{t("dataSection.allHistory")}</Button>
  {#if cleared}<span class="done"><Icon name="check" size={12} /> {t("dataSection.historyCleared")}</span>{/if}
  <ConfirmButton variant="outlined" question={t("dataSection.allHistory2")} confirmLabel={t("dataSection.clear")} onconfirm={clearHistory}>
    <Icon name="trash" size={12} /> {t("dataSection.clearHistory")}
  </ConfirmButton>
</Row>

<Row anchor="bookmarks" label={t("dataSection.bookmarks")} hint={bookmarks.length ? t("dataSection.bookmarkedPages", { bookmarksCount: bookmarks.length }) : t("dataSection.noBookmarksYetAdds", { p: platform.shortcut("toggle-bookmark") })} stacked={bookmarks.length > 0}>
  {#if bookmarks.length}
    <ul class="bookmarks" aria-label={t("dataSection.bookmarks")}>
      {#each bookmarks as bookmark (bookmark.id)}
        <li>
          <Favicon src={bookmark.favicon} />
          <span class="text">
            <span class="title">{bookmark.title}</span>
            <span class="url">{displayUrl(bookmark.url)}</span>
          </span>
          <button class="remove" aria-label={t("dataSection.removeFromBookmarks", { title: bookmark.title })} title={t("dataSection.removeFromBookmarks2")} onclick={() => remove(bookmark.id)}>
            <Icon name="close" size={12} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Row>

<style>
  /* In scrolling lists: an inset ring is never clipped. */
  button:focus-visible {
    outline-offset: -2px;
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
