<script lang="ts">
  import { t as tr, t } from "@shared/i18n";
  import { READER_THEME_LABELS, READER_WIDTHS, readerColors, readingTimeLabel, type ReaderArticle } from "@shared/reader";
  import { speechParagraphs } from "@shared/read-aloud";
  import { pageStep, presentationKeyAction, sectionTarget } from "@shared/reader-presentation";
  import { LIMITS, type ReaderFont, type ReaderTheme, type ReaderWidth } from "@shared/settings";
  import type { TabState } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import { platform } from "../../lib/platform.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import ReaderNodes from "./ReaderNodes.svelte";
  import ReadAloudControls from "./ReadAloudControls.svelte";
  import { presentation, readAloud, readerRequests, reducedMotion } from "../../lib/read-aloud.svelte";

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
  const presenting = $derived(presentation.active && !!article);
  let scroller = $state<HTMLElement>();
  /** Presentation mode: the bar shows for a moment after the pointer moves, and while hovered or focused. */
  let barShown = $state(true);
  let barTimer: ReturnType<typeof setTimeout> | undefined;
  /** Paths of the blocks read aloud as one paragraph (ADR-058), marked `data-speech` for the highlight. */
  const marks = $derived(article ? new Set(speechParagraphs(article).map((paragraph) => paragraph.key)) : undefined);
  const colors = $derived(readerColors(prefs.theme, browser.isPrivate || settings.mode === "dark"));
  const style = $derived(
    `--reader-bg: ${colors.background}; --reader-text: ${colors.text}; --reader-muted: ${colors.muted}; ` +
      `--reader-link: ${colors.link}; --reader-rule: ${colors.rule}; --reader-size: ${prefs.size}px; ` +
      `--reader-width: ${READER_WIDTHS[prefs.width]}ch;` +
      (presenting ? ` --reader-size: ${prefs.presentationSize}px; --reader-width: 72ch;` : ""),
  );

  // Commands from main (menu, palette, shortcut): read aloud or present this article.
  $effect(() => {
    if (!article || !readerRequests.pending) return;
    const request = readerRequests.take();
    if (request === "presentation") togglePresentation();
    else if (readAloud.tabId === tab.id && readAloud.status !== "idle") readAloud.toggle();
    else readAloud.start(tab.id, article);
  });

  // The paragraph read aloud: highlighted and kept in view (no glide with reduced motion).
  $effect(() => {
    void article;
    const key = readAloud.tabId === tab.id ? readAloud.activeKey : null;
    const root = scroller;
    if (!key || !root) return;
    const element = key === "title" ? root.querySelector("h1") : root.querySelector(`[data-speech="${CSS.escape(key)}"]`);
    if (!element) return;
    element.setAttribute("data-speaking", "");
    element.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    return () => element.removeAttribute("data-speaking");
  });

  // Presentation mode: full screen while shown, back as before when it ends (or the reader closes).
  $effect(() => {
    if (!presenting) return;
    api.reader.present(true);
    scroller?.focus();
    revealBar();
    return () => api.reader.present(false);
  });
  $effect(() => () => {
    presentation.active = false;
    clearTimeout(barTimer);
  });

  function togglePresentation(): void {
    presentation.active = !presentation.active;
  }

  function revealBar(): void {
    barShown = true;
    clearTimeout(barTimer);
    barTimer = setTimeout(() => (barShown = false), 2200);
  }

  const setPresentationSize = (presentationSize: number) => settings.update({ reader: { presentationSize } });

  function scrollToTop(top: number): void {
    scroller?.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
  }

  function onPresentationKey(event: KeyboardEvent): void {
    if (!presenting || event.ctrlKey || event.metaKey || event.altKey) return;
    const action = presentationKeyAction(event.key, event.shiftKey);
    // Controls of the bar keep their own keys (a select's arrows, a button's space).
    const control = (event.target as HTMLElement | null)?.closest?.("button, select, input");
    if (!action || !scroller || (control && action !== "exit")) return;
    event.preventDefault();
    const root = scroller;
    const offset = root.getBoundingClientRect().top;
    switch (action) {
      case "exit":
        presentation.active = false;
        return;
      case "larger":
      case "smaller": {
        const next = prefs.presentationSize + (action === "larger" ? 2 : -2);
        const { min, max } = LIMITS.readerPresentationSize;
        void setPresentationSize(Math.min(max, Math.max(min, next)));
        return;
      }
      case "first":
        return scrollToTop(0);
      case "last":
        return scrollToTop(root.scrollHeight);
      case "next-page":
      case "previous-page":
        return scrollToTop(root.scrollTop + (action === "next-page" ? 1 : -1) * pageStep(root.clientHeight));
      default: {
        const tops = [...root.querySelectorAll("article h1, article h2, article h3, article h4")].map(
          (heading) => heading.getBoundingClientRect().top - offset + root.scrollTop - 24,
        );
        const target = sectionTarget(tops, root.scrollTop, action === "next-section" ? 1 : -1);
        if (target !== null) scrollToTop(target);
      }
    }
  }

  const FONTS: { value: ReaderFont; label: string }[] = [
    { value: "serif", label: "Serif" },
    { value: "sans", label: tr("readerView.sansSerif") },
  ];
  const WIDTHS: { value: ReaderWidth; label: string }[] = [
    { value: "narrow", label: t("readerView.narrow") },
    { value: "medium", label: t("readerView.medium") },
    { value: "wide", label: t("readerView.wide") },
  ];
  const THEMES: ReaderTheme[] = ["auto", "sepia", "dark"];

  const setSize = (size: number) => settings.update({ reader: { size } });

  function openLink(href: string, newTab: boolean): void {
    if (newTab) api.tabs.create(href);
    else api.tabs.navigate(tab.id, href);
  }

  const exit = () => api.commands.run("toggle-reader");
</script>

<svelte:window onkeydown={onPresentationKey} />

<div
  class="reader"
  class:sans={prefs.font === "sans"}
  class:presenting
  {style}
  data-testid="reader-view"
  role={presenting ? "dialog" : undefined}
  aria-label={presenting ? t("presentation.enter") : undefined}
  onpointermove={presenting ? revealBar : undefined}
>
  {#if presenting && article}
    <div class="toolbar present-bar" class:shown={barShown} role="toolbar" aria-label={t("presentation.controls")} data-testid="presentation-bar">
      <button type="button" class="tool" title={platform.tip(t("presentation.exit"), "reader-presentation")} onclick={togglePresentation}>
        <Icon name="close" size={14} />
        <span>{t("presentation.exit")}</span>
      </button>
      <span class="hint">{t("presentation.hint")}</span>
      <span class="spacer"></span>
      <ReadAloudControls tabId={tab.id} {article} />
      <div class="group" role="group" aria-label={t("readerView.textSize")}>
        <button type="button" class="choice" aria-label={t("readerView.smallerText")} disabled={prefs.presentationSize <= LIMITS.readerPresentationSize.min} onclick={() => setPresentationSize(prefs.presentationSize - 2)}
          ><Icon name="type" size={11} /></button
        >
        <span class="value" aria-live="polite">{prefs.presentationSize}&#8239;px</span>
        <button type="button" class="choice" aria-label={t("readerView.largerText")} disabled={prefs.presentationSize >= LIMITS.readerPresentationSize.max} onclick={() => setPresentationSize(prefs.presentationSize + 2)}
          ><Icon name="type" size={15} /></button
        >
      </div>
      <div class="group" role="radiogroup" aria-label={t("readerView.readingTheme")}>
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
  {/if}
  <div class="toolbar" role="toolbar" aria-label={t("readerView.readingOptions")} class:off={presenting}>
    <button type="button" class="tool" title={platform.tip(t("readerView.exitReaderMode"), "toggle-reader")} onclick={exit}>
      <Icon name="back" size={14} />
      <span>{t("readerView.exit")}</span>
    </button>
    {#if article}
      <ReadAloudControls tabId={tab.id} {article} />
      <button type="button" class="tool" title={platform.tip(t("presentation.enter"), "reader-presentation")} onclick={togglePresentation} data-testid="presentation-enter">
        <Icon name="presentation" size={14} />
        <span>{t("presentation.enter")}</span>
      </button>
    {/if}
    <span class="spacer"></span>
    <div class="group" role="radiogroup" aria-label={t("readerView.font")}>
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
    <div class="group" role="group" aria-label={t("readerView.textSize")}>
      <button type="button" class="choice" aria-label={t("readerView.smallerText")} disabled={prefs.size <= LIMITS.readerSize.min} onclick={() => setSize(prefs.size - 1)}
        ><Icon name="type" size={11} /></button
      >
      <span class="value" aria-live="polite">{prefs.size}&#8239;px</span>
      <button type="button" class="choice" aria-label={t("readerView.largerText")} disabled={prefs.size >= LIMITS.readerSize.max} onclick={() => setSize(prefs.size + 1)}
        ><Icon name="type" size={15} /></button
      >
    </div>
    <div class="group" role="radiogroup" aria-label={t("readerView.lineWidth")}>
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
    <div class="group" role="radiogroup" aria-label={t("readerView.readingTheme")}>
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

  <div class="scroll" bind:this={scroller} tabindex="-1">
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
        <div class="content"><ReaderNodes nodes={article.content} onlink={openLink} {marks} /></div>
      </article>
    {:else if loaded}
      <p class="empty">{t("readerView.articleNoLongerAvailable")}</p>
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
  /* Presentation mode (ADR-058): the article alone over the whole window (the page view is detached). */
  .reader.presenting {
    position: fixed;
    inset: 0;
    z-index: 100;
    border-radius: 0;
  }
  .present-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1;
    background: var(--reader-bg);
    opacity: 0;
    transition: opacity var(--motion-fast) ease-out;
  }
  .present-bar.shown,
  .present-bar:hover,
  .present-bar:focus-within {
    opacity: 1;
  }
  .hint {
    color: var(--reader-muted);
  }
  .toolbar.off {
    display: none;
  }
  .presenting .scroll {
    padding: 72px 32px 30vh;
    outline: none;
  }
  .presenting article {
    line-height: 1.6;
  }
  .content :global([data-speaking]),
  h1:global([data-speaking]) {
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--reader-link) 14%, transparent);
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--reader-link) 14%, transparent);
    transition:
      background-color var(--motion-fast) ease-out,
      box-shadow var(--motion-fast) ease-out;
  }
  .scroll:focus-visible {
    outline: none;
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
