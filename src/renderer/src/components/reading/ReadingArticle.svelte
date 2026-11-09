<script lang="ts">
  import { t } from "@shared/i18n";
  import { READER_WIDTHS, readerColors, readingTimeLabel } from "@shared/reader";
  import { readingArticle, type ReadingItem } from "@shared/reading-list";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import ReaderNodes from "../reader/ReaderNodes.svelte";
  import Button from "../ui/Button.svelte";

  /**
   * The offline copy of a reading list item (ADR-047), drawn like reader mode (ADR-026) with its
   * preferences: plain paragraphs main kept when the page was added, no network involved.
   */
  let { id, onBack }: { id: string; onBack: () => void } = $props();

  let item = $state<ReadingItem | null>(null);
  let loaded = $state(false);

  $effect(() => {
    const current = id;
    loaded = false;
    let alive = true;
    void api.reading
      .get(current)
      .catch(() => null)
      .then((next) => {
        if (!alive) return;
        item = next;
        loaded = true;
      });
    return () => (alive = false);
  });

  const article = $derived(item && item.text ? readingArticle(item) : null);
  const prefs = $derived(settings.current.reader);
  const colors = $derived(readerColors(prefs.theme, browser.isPrivate || settings.mode === "dark"));
  const style = $derived(
    `--reader-bg: ${colors.background}; --reader-text: ${colors.text}; --reader-muted: ${colors.muted}; ` +
      `--reader-link: ${colors.link}; --reader-rule: ${colors.rule}; --reader-size: ${prefs.size}px; ` +
      `--reader-width: ${READER_WIDTHS[prefs.width]}ch;`,
  );

  function openPage(): void {
    if (item) api.tabs.create(item.url);
  }
</script>

<div class="offline" class:sans={prefs.font === "sans"} {style} data-testid="reading-article">
  <div class="toolbar">
    <Button size="sm" variant="quiet" icon="back" onclick={onBack}>{t("readingArticle.readingList")}</Button>
    <span class="spacer"></span>
    {#if item}<Button size="sm" variant="quiet" icon="open" onclick={openPage}>{t("readingArticle.openPage")}</Button>{/if}
  </div>
  <div class="scroll">
    {#if article}
      <article>
        <p class="meta"><Icon name="book-marked" size={14} /> {t("readingArticle.offlineCopy")}{#if article.siteName}&nbsp;· {article.siteName}{/if} · {readingTimeLabel(article.minutes)}</p>
        <h1>{article.title}</h1>
        <div class="content"><ReaderNodes nodes={article.content} onlink={(href) => api.tabs.create(href)} /></div>
      </article>
    {:else if loaded}
      <p class="empty">
        {item ? t("readingArticle.noTextCouldSaved") : t("readingArticle.pageNoLongerReading")}
      </p>
    {/if}
  </div>
</div>

<style>
  .offline {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--reader-bg);
    color: var(--reader-text);
    font-family: Charter, "Iowan Old Style", Georgia, "Times New Roman", serif;
  }
  .offline.sans {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--reader-rule);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .spacer {
    flex: 1;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-6) var(--space-5);
  }
  article {
    max-width: var(--reader-width);
    margin: 0 auto;
    font-size: var(--reader-size);
    line-height: 1.65;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--reader-muted);
    font-size: var(--text-sm);
  }
  h1 {
    font-size: 1.8em;
    line-height: 1.2;
  }
  .content :global(a) {
    color: var(--reader-link);
  }
  .empty {
    color: var(--reader-muted);
    text-align: center;
  }
</style>
