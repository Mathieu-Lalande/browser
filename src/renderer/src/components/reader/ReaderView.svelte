<script lang="ts">
  import { READER_THEME_LABELS, READER_WIDTHS, readerColors, readingTimeLabel, type ReaderArticle } from "@shared/reader";
  import { LIMITS, type ReaderFont, type ReaderTheme, type ReaderWidth } from "@shared/settings";
  import type { TabState } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import { platform } from "../../lib/platform.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import ReaderNodes from "./ReaderNodes.svelte";

  /**
   * Reader mode (ADR-026), drawn by the chrome UI in place of the page view (main detaches it):
   * the article main extracted and validated, with the reader preferences (shared settings).
   */
  let { tab }: { tab: TabState } = $props();

  let article = $state<ReaderArticle | null>(null);
  let loaded = $state(false);

  $effect(() => {
    const id = tab.id;
    void tab.url;
    loaded = false;
    let current = true;
    api.reader
      .article(id)
      .catch(() => null)
      .then((next) => {
        if (!current) return;
        article = next;
        loaded = true;
      });
    return () => (current = false);
  });

  const prefs = $derived(settings.current.reader);
  const colors = $derived(readerColors(prefs.theme, browser.isPrivate || settings.mode === "dark"));
  const style = $derived(
    `--reader-bg: ${colors.background}; --reader-text: ${colors.text}; --reader-muted: ${colors.muted}; ` +
      `--reader-link: ${colors.link}; --reader-rule: ${colors.rule}; --reader-size: ${prefs.size}px; ` +
      `--reader-width: ${READER_WIDTHS[prefs.width]}ch;`,
  );

  const FONTS: { value: ReaderFont; label: string }[] = [
    { value: "serif", label: "Serif" },
    { value: "sans", label: "Sans serif" },
  ];
  const WIDTHS: { value: ReaderWidth; label: string }[] = [
    { value: "narrow", label: "Étroite" },
    { value: "medium", label: "Moyenne" },
    { value: "wide", label: "Large" },
  ];
  const THEMES: ReaderTheme[] = ["auto", "sepia", "dark"];

  const setSize = (size: number) => settings.update({ reader: { size } });

  function openLink(href: string, newTab: boolean): void {
    if (newTab) api.tabs.create(href);
    else api.tabs.navigate(tab.id, href);
  }

  const exit = () => api.commands.run("toggle-reader");
</script>

<div class="reader" class:sans={prefs.font === "sans"} {style} data-testid="reader-view">
  <div class="toolbar" role="toolbar" aria-label="Options de lecture">
    <button type="button" class="tool" title={platform.tip("Quitter le mode lecture", "toggle-reader")} onclick={exit}>
      <Icon name="back" size={14} />
      <span>Quitter</span>
    </button>
    <span class="spacer"></span>
    <div class="group" role="radiogroup" aria-label="Police">
      {#each FONTS as font (font.value)}
        <button
          type="button"
          role="radio"
          aria-checked={prefs.font === font.value}
          class="choice"
          class:serif={font.value === "serif"}
          onclick={() => settings.update({ reader: { font: font.value } })}>{font.label}</button
        >
      {/each}
    </div>
    <div class="group" role="group" aria-label="Taille du texte">
      <button type="button" class="choice" aria-label="Réduire le texte" disabled={prefs.size <= LIMITS.readerSize.min} onclick={() => setSize(prefs.size - 1)}
        ><Icon name="type" size={11} /></button
      >
      <span class="value" aria-live="polite">{prefs.size}&#8239;px</span>
      <button type="button" class="choice" aria-label="Agrandir le texte" disabled={prefs.size >= LIMITS.readerSize.max} onclick={() => setSize(prefs.size + 1)}
        ><Icon name="type" size={15} /></button
      >
    </div>
    <div class="group" role="radiogroup" aria-label="Largeur des lignes">
      <Icon name="move-horizontal" size={13} />
      {#each WIDTHS as width (width.value)}
        <button
          type="button"
          role="radio"
          aria-checked={prefs.width === width.value}
          class="choice"
          onclick={() => settings.update({ reader: { width: width.value } })}>{width.label}</button
        >
      {/each}
    </div>
    <div class="group" role="radiogroup" aria-label="Thème de lecture">
      {#each THEMES as theme (theme)}
        <button
          type="button"
          role="radio"
          aria-checked={prefs.theme === theme}
          class="choice swatch {theme}"
          onclick={() => settings.update({ reader: { theme } })}>{READER_THEME_LABELS[theme]}</button
        >
      {/each}
    </div>
  </div>

  <div class="scroll">
    {#if article}
      <article lang={article.lang ?? undefined} dir={article.dir ?? undefined}>
        <header>
          {#if article.siteName}<p class="site">{article.siteName}</p>{/if}
          <h1>{article.title || tab.title}</h1>
          <p class="meta">
            {#if article.byline}<span>{article.byline}</span><span aria-hidden="true">·</span>{/if}
            <span><Icon name="clock" size={12} /> {readingTimeLabel(article.minutes)}</span>
          </p>
        </header>
        <div class="content"><ReaderNodes nodes={article.content} onlink={openLink} /></div>
      </article>
    {:else if loaded}
      <p class="empty">Cet article n'est plus disponible en mode lecture.</p>
    {/if}
  </div>
</div>

<style>
  .reader {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--reader-bg);
    color: var(--reader-text);
    border-radius: inherit;
    overflow: hidden;
    font-family: Charter, "Iowan Old Style", Georgia, "Times New Roman", serif;
  }
  .reader.sans {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--reader-rule);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--reader-rule);
    border-radius: 8px;
    color: var(--reader-muted);
  }
  .group > :global(svg) {
    margin: 0 4px;
  }
  .tool,
  .choice {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--reader-text);
    font: inherit;
  }
  .tool:hover,
  .choice:hover:not(:disabled) {
    background: color-mix(in srgb, var(--reader-text) 8%, transparent);
  }
  .choice[aria-checked="true"] {
    background: color-mix(in srgb, var(--reader-link) 18%, transparent);
    color: var(--reader-text);
    font-weight: 600;
  }
  .choice:disabled {
    opacity: 0.4;
  }
  .choice.serif {
    font-family: Georgia, serif;
  }
  .swatch.sepia {
    background-color: #f4ecd8;
    color: #4a3a2a;
  }
  .swatch.dark {
    background-color: #18181b;
    color: #e4e4e7;
  }
  .swatch.sepia[aria-checked="true"],
  .swatch.dark[aria-checked="true"] {
    outline: 2px solid var(--reader-link);
    outline-offset: -2px;
  }
  .value {
    min-width: 40px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .tool:focus-visible,
  .choice:focus-visible {
    outline: 2px solid var(--reader-link);
    outline-offset: 1px;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 40px 24px 80px;
  }
  article {
    max-width: var(--reader-width);
    margin: 0 auto;
    font-size: var(--reader-size);
    line-height: 1.65;
    overflow-wrap: break-word;
  }
  header {
    margin-bottom: 2em;
    padding-bottom: 1em;
    border-bottom: 1px solid var(--reader-rule);
  }
  .site {
    margin: 0 0 0.4em;
    color: var(--reader-muted);
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  h1 {
    margin: 0 0 0.4em;
    font-size: 1.9em;
    line-height: 1.2;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin: 0;
    color: var(--reader-muted);
    font-size: 0.8em;
  }
  .meta span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .content :global(a) {
    color: var(--reader-link);
  }
  .content :global(img) {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 1em auto;
    border-radius: 6px;
  }
  .content :global(figcaption) {
    color: var(--reader-muted);
    font-size: 0.85em;
    text-align: center;
  }
  .content :global(blockquote) {
    margin: 1em 0;
    padding-left: 1em;
    border-left: 3px solid var(--reader-rule);
    color: var(--reader-muted);
  }
  .content :global(pre) {
    overflow-x: auto;
    padding: 0.8em;
    border-radius: 6px;
    background: color-mix(in srgb, var(--reader-text) 6%, transparent);
    font-size: 0.85em;
  }
  .content :global(code) {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.9em;
  }
  .content :global(table) {
    border-collapse: collapse;
    font-size: 0.9em;
  }
  .content :global(th),
  .content :global(td) {
    padding: 4px 8px;
    border: 1px solid var(--reader-rule);
  }
  .content :global(hr) {
    border: 0;
    border-top: 1px solid var(--reader-rule);
  }
  .content :global(h2),
  .content :global(h3),
  .content :global(h4) {
    line-height: 1.3;
  }
  .empty {
    color: var(--reader-muted);
    text-align: center;
  }
</style>
