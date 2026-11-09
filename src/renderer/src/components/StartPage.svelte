<script lang="ts">
  import { t } from "@shared/i18n";
  import type { CommandId } from "@shared/commands";
  import type { StartBackground } from "@shared/settings";
  import { LAYOUT_PRESETS, WIDGET_CATALOG, visibleWidgets, type WidgetKind } from "@shared/start-widgets";
  import { tick } from "svelte";
  import { flip } from "svelte/animate";
  import { api, browser } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import { settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";
  import { StartLayout } from "./start/layout.svelte";
  import WidgetCard from "./start/WidgetCard.svelte";
  import DefaultBrowserPrompt from "./start/DefaultBrowserPrompt.svelte";
  import RestoreSessionCard from "./start/RestoreSessionCard.svelte";
  import WidgetGallery from "./start/WidgetGallery.svelte";
  import Button from "./ui/Button.svelte";
  import Segmented from "./ui/Segmented.svelte";

  /**
   * The new tab page (ADR-034): a grid of widgets the user arranges ("Personnaliser"), over an
   * optional background. A private window can rearrange it for the moment; nothing is saved.
   */
  const layout = new StartLayout(() => browser.isPrivate);
  const widgets = $derived(visibleWidgets(layout.widgets, { isPrivate: browser.isPrivate }));
  const hasHeading = $derived(!browser.isPrivate && widgets.some((widget) => widget.kind === "clock"));

  // Pending notes are saved when the page goes away (a new page in this tab, or the window closes).
  $effect(() => {
    const flush = () => layout.flush();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  });

  const options = $derived(settings.current.startPage);
  const image = $derived(options.background === "image" && options.backgroundImage ? options.backgroundImage : null);
  /**
   * The image itself, as a data: URL fetched by main: the UI loads no remote image (CSP
   * `img-src 'self' data:`, ADR-018). Private windows keep their own look and do not load it.
   */
  let imageData = $state<string | null>(null);
  $effect(() => {
    const url = image;
    imageData = null;
    if (!url || browser.isPrivate) return;
    api.settings.startImage().then(
      (data) => {
        if (image === url) imageData = data;
      },
      () => {},
    );
  });
  const background = $derived(browser.isPrivate ? "theme" : options.background);

  /** Shortcut hints, from the command registry (keys as on the keyboard of this platform). */
  const HINTS: { id: CommandId; label: string }[] = [
    { id: "command-palette", label: t("startPage.commandPalette") },
    { id: "focus-address", label: t("startPage.addressBar") },
    { id: "new-tab", label: t("startPage.newTab") },
    { id: "toggle-sidebar", label: t("startPage.sidebar") },
  ];
  const hints = $derived(
    HINTS.map((hint) => ({ ...hint, keys: platform.keys(hint.id) })).filter((hint) => hint.keys.length > 0),
  );

  // --- Edit mode ------------------------------------------------------------------------------

  let editing = $state(false);
  let galleryOpen = $state(false);
  let optionsFor = $state<string | null>(null);
  let announcement = $state("");
  let board = $state<HTMLElement>();
  let customize = $state<HTMLButtonElement>();

  const reduceMotion = $derived(settings.current.appearance.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches);
  const flipDuration = $derived(reduceMotion ? 0 : 140);

  async function stopEditing(): Promise<void> {
    editing = galleryOpen = false;
    optionsFor = null;
    layout.flush();
    await tick();
    customize?.focus();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (!editing || event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    if (optionsFor) optionsFor = null;
    else void stopEditing();
  }

  async function focusWidget(id: string): Promise<void> {
    await tick();
    board?.querySelector<HTMLElement>(`[data-widget-id="${id}"]`)?.focus();
  }

  function moveBy(id: string, delta: number): void {
    // Moves among the widgets shown, which may skip hidden ones (private window): by position in the full list.
    const shown = widgets.findIndex((widget) => widget.id === id);
    const target = widgets[shown + delta];
    if (!target) return;
    const kind = widgets[shown].kind;
    layout.move(id, layout.widgets.findIndex((widget) => widget.id === target.id));
    announcement = t("startPage.position", { p: WIDGET_CATALOG[kind].label, p2: shown + delta + 1, widgetsCount: widgets.length });
    void focusWidget(id);
  }

  function add(kind: WidgetKind): void {
    const id = layout.add(kind);
    galleryOpen = false;
    if (id) {
      announcement = t("startPage.added", { p: WIDGET_CATALOG[kind].label });
      void focusWidget(id);
    }
  }

  // Drag and drop between cards (edit mode).
  let dragId = $state<string | null>(null);
  let overId = $state<string | null>(null);

  function drop(): void {
    if (dragId && overId && dragId !== overId) layout.move(dragId, layout.widgets.findIndex((widget) => widget.id === overId));
    dragId = overId = null;
  }

  const BACKGROUNDS: { value: StartBackground; label: string }[] = [
    { value: "theme", label: t("startPage.theme") },
    { value: "aurora", label: t("startPage.aurora") },
    { value: "dynamic", label: t("startPage.dynamic") },
    { value: "image", label: t("startPage.image") },
  ];
</script>

<svelte:window onkeydown={onWindowKeydown} />

<section
  class="start"
  class:aurora={background === "aurora"}
  class:dynamic={background === "dynamic"}
  class:image={imageData !== null}
  class:editing
  style:--start-image={imageData ? `url("${imageData}")` : undefined}
>
  <div class="top">
    {#if editing}
      <div class="toolbar" role="toolbar" aria-label={t("startPage.customizeStartPage")}>
        <Button variant="primary" size="sm" icon="plus" onclick={() => (galleryOpen = true)}>{t("startPage.addWidget")}</Button>
        <span class="group" role="group" aria-label={t("startPage.layouts")}>
          {#each LAYOUT_PRESETS as preset (preset.id)}
            <Button size="sm" onclick={() => layout.preset(preset.id)}>{preset.label}</Button>
          {/each}
          <Button size="sm" variant="ghost" icon="reset" onclick={() => layout.reset()}>{t("startPage.reset")}</Button>
        </span>
        {#if !browser.isPrivate}
          <Segmented label={t("startPage.startPageBackground")} value={options.background} options={BACKGROUNDS} onchange={(value) => settings.update({ startPage: { background: value } })} />
        {/if}
        <Button size="sm" icon="check" onclick={stopEditing}>{t("startPage.done")}</Button>
      </div>
    {:else}
      <Button bind:element={customize} size="sm" variant="ghost" icon="layout-dashboard" onclick={() => (editing = true)}>{t("startPage.customize")}</Button>
    {/if}
  </div>

  {#if browser.isPrivate}
    <div class="private-hero">
      <span class="mask"><Icon name="mask" size={32} /></span>
      <h1>{t("startPage.privateBrowsing")}</h1>
    </div>
  {:else if !hasHeading}
    <h1 class="visually-hidden">{t("startPage.newTab2")}</h1>
  {/if}

  <RestoreSessionCard />
  <DefaultBrowserPrompt />

  <div class="board" bind:this={board}>
    <div class="grid" role="list" aria-label={t("startPage.startPageWidgets")}>
      {#each widgets as widget, index (widget.id)}
        <div class="cell size-{widget.size}" animate:flip={{ duration: flipDuration }}>
          <WidgetCard
            {widget}
            {layout}
            {editing}
            position={index + 1}
            total={widgets.length}
            optionsOpen={optionsFor === widget.id}
            dragging={dragId === widget.id}
            dropTarget={overId === widget.id && dragId !== widget.id}
            onmove={(delta) => moveBy(widget.id, delta)}
            ontoggleoptions={() => (optionsFor = optionsFor === widget.id ? null : widget.id)}
            ondragstart={() => ((dragId = widget.id), (optionsFor = null))}
            ondragover={() => (overId = widget.id)}
            ondrop={drop}
            ondragend={() => (dragId = overId = null)}
          />
        </div>
      {/each}
    </div>
    {#if editing && widgets.length === 0}
      <p class="empty">{t("startPage.emptyPageAddWidget")}</p>
    {/if}
  </div>

  {#if browser.isPrivate}
    <ul class="private" aria-label={t("startPage.whatPrivateBrowsingKeeps")}>
      <li><Icon name="check" size={16} /> {t("startPage.noHistoryNoTop")}</li>
      <li><Icon name="check" size={16} /> {t("startPage.cookiesCacheSiteData")}</li>
      <li><Icon name="check" size={16} /> {t("startPage.permissionsGrantedWindowOnly")}</li>
      <li class="kept"><Icon name="star" size={16} /> {t("startPage.bookmarksYouAddFiles")}</li>
    </ul>
  {/if}
  {#if !editing}
    <ul class="hints" aria-label={t("startPage.keyboardShortcuts")}>
      {#each hints as hint (hint.id)}
        <li>
          <span class="keys">{#each hint.keys as key, index (index)}<kbd>{key}</kbd>{/each}</span>
          {hint.label}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="visually-hidden" aria-live="polite">{announcement}</p>
</section>

{#if galleryOpen}
  <WidgetGallery widgets={layout.widgets} isPrivate={browser.isPrivate} onadd={add} onclose={() => (galleryOpen = false)} />
{/if}

<style>
  .start {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    height: 100%;
    padding: 56px 24px 24px;
    overflow: auto;
    animation: rise var(--motion-base) var(--ease);
  }
  .top {
    position: absolute;
    top: 12px;
    right: 16px;
    left: 16px;
    z-index: 2;
    display: flex;
    justify-content: flex-end;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: color-mix(in oklab, var(--bg-elevated) 90%, transparent);
    backdrop-filter: blur(12px);
    animation: rise var(--motion-fast) var(--ease);
  }
  .group {
    display: flex;
    gap: 4px;
  }
  .start.editing {
    padding-top: 96px;
  }
  /* Optional backgrounds, behind the content (z-index -1 within the isolated section). */
  .start.aurora::before,
  .start.dynamic::before,
  .start.dynamic::after,
  .start.image::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }
  .start.aurora::before {
    background:
      radial-gradient(45% 55% at 20% 25%, color-mix(in oklab, var(--accent) 38%, transparent), transparent 70%),
      radial-gradient(40% 50% at 80% 30%, color-mix(in oklab, var(--accent-2) 32%, transparent), transparent 70%),
      radial-gradient(50% 45% at 55% 90%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 70%);
    filter: blur(20px);
    animation: drift 18s ease-in-out infinite alternate;
  }
  /* "Fond dynamique": two meshes of the accent colors moving slowly against each other; still
     when motion is reduced (the global rule stops every animation). */
  .start.dynamic::before {
    background:
      radial-gradient(40% 50% at 15% 20%, color-mix(in oklab, var(--accent) 42%, transparent), transparent 70%),
      radial-gradient(35% 45% at 85% 75%, color-mix(in oklab, var(--accent-2) 36%, transparent), transparent 70%);
    filter: blur(30px);
    animation: orbit 26s ease-in-out infinite alternate;
  }
  .start.dynamic::after {
    background:
      radial-gradient(30% 40% at 70% 15%, color-mix(in oklab, var(--accent-2) 26%, transparent), transparent 70%),
      radial-gradient(45% 40% at 30% 85%, color-mix(in oklab, var(--accent) 24%, transparent), transparent 70%);
    filter: blur(40px);
    animation: orbit 34s ease-in-out -12s infinite alternate-reverse;
  }
  .start.image::before {
    background:
      linear-gradient(color-mix(in oklab, var(--bg-elevated) 35%, transparent), color-mix(in oklab, var(--bg-elevated) 70%, transparent)),
      var(--start-image) center / cover no-repeat;
  }
  .board {
    width: min(920px, 100%);
    margin: auto 0;
    container: start-grid / inline-size;
  }
  .grid {
    --columns: 4;
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    grid-auto-flow: row dense;
    gap: 14px;
  }
  .cell {
    display: flex;
    min-width: 0;
    flex-direction: column;
    grid-column: span 1;
  }
  .cell > :global(*) {
    flex: 1;
  }
  .cell.size-m {
    grid-column: span 2;
  }
  .cell.size-l {
    grid-column: 1 / -1;
  }
  @container start-grid (max-width: 640px) {
    .grid {
      --columns: 2;
    }
  }
  @container start-grid (max-width: 380px) {
    .cell.size-s,
    .cell.size-m {
      grid-column: 1 / -1;
    }
  }
  .empty {
    color: var(--text-faint);
    font-size: 13px;
    text-align: center;
  }
  .private-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 18px;
  }
  .private-hero h1 {
    margin: 0;
    font-size: clamp(32px, 5vw, 52px);
    font-weight: 600;
    letter-spacing: -0.04em;
    background: linear-gradient(120deg, var(--text) 30%, var(--accent-text) 85%);
    background-clip: text;
    color: transparent;
  }
  .mask {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    margin-bottom: 10px;
    border-radius: 20px;
    background: linear-gradient(140deg, color-mix(in oklab, var(--accent) 40%, transparent), color-mix(in oklab, var(--accent-2) 30%, transparent));
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent),
      0 18px 50px -18px var(--accent);
    color: var(--text);
  }
  .private {
    display: grid;
    gap: 9px;
    width: min(620px, 100%);
    margin: 24px 0 0;
    padding: 16px 20px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: color-mix(in oklab, var(--bg-elevated) 70%, transparent);
    color: var(--text-muted);
    font-size: 13px;
    list-style: none;
  }
  .private li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .private li > :global(svg) {
    flex: none;
    color: var(--accent-text);
  }
  .private li.kept {
    color: var(--text-faint);
  }
  .private li.kept > :global(svg) {
    color: var(--text-faint);
  }
  .hints {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 18px;
    margin: 22px 0 0;
    padding: 0;
    color: var(--text-faint);
    font-size: 12px;
    list-style: none;
  }
  .hints li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .keys {
    display: flex;
    gap: 3px;
  }
  kbd {
    min-width: 20px;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    font: inherit;
    font-size: 11px;
    text-align: center;
  }
  @keyframes drift {
    to {
      transform: scale(1.08) translate(2%, -2%);
    }
  }
  @keyframes orbit {
    33% {
      transform: translate(4%, 3%) scale(1.06) rotate(4deg);
    }
    66% {
      transform: translate(-3%, 5%) scale(0.97) rotate(-3deg);
    }
    to {
      transform: translate(2%, -4%) scale(1.1) rotate(2deg);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
