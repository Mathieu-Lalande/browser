<script lang="ts">
  import { t } from "@shared/i18n";
  import { mergeSuggestions, type Suggestion } from "@shared/search";
  import { internalPageOf } from "@shared/internal";
  import type { Bookmark } from "@shared/types";
  import { displayUrl, normalizeInput, searchUrl } from "@shared/url";
  import { formatDuration } from "@shared/capture";
  import { api, browser } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import { settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";
  import { extensionsUi } from "../lib/extensions.svelte";
  import SuggestionList from "./address/SuggestionList.svelte";

  const MAX_SUGGESTIONS = 6;

  let input: HTMLInputElement;
  let focused = $state(false);
  let draft = $state("");
  /** True once the user typed since focusing: suggestions only follow actual typing. */
  let typed = $state(false);
  let suggestions = $state<Suggestion[]>([]);
  /** 0 is the "search for / go to" row, 1… the suggestions. */
  let selected = $state(0);
  let bookmarks: Bookmark[] = [];
  let request = 0;

  const tab = $derived(browser.activeTab);
  const isSecure = $derived(tab?.url.startsWith("https://") ?? false);
  /** Internal pages (browser://…) are trusted, and cannot be bookmarked. */
  const isInternal = $derived(internalPageOf(tab?.url ?? "") !== null);
  const label = $derived(tab?.url ? displayUrl(tab.url) : "");
  const query = $derived(draft.trim());
  const open = $derived(focused && typed && query !== "");
  const isSearch = $derived(normalizeInput(query, settings.engine) === searchUrl(query, settings.engine));

  // Focus may come before the state of a just-created tab: follow the active tab until the user types.
  $effect(() => {
    const url = tab?.url ?? "";
    if (focused && !typed) {
      draft = url;
      queueMicrotask(() => input.select());
    }
  });

  /** Zoom indicator: shown when the page is not at the default zoom. */
  const defaultZoom = $derived(settings.current.appearance.pageZoom);
  const zoomed = $derived(!!tab && (/^https?:|^data:/.test(tab.url) || isInternal) && !tab.interstitial && tab.zoom !== defaultZoom);

  const showShield = $derived(!!tab && /^https?:/.test(tab.url) && !tab.interstitial);
  const shieldTitle = t("addressBar.protectionsTurnedOffSite");

  /** Web pages get the site info popover. */
  const isWebPage = $derived(!!tab && /^https?:/.test(tab.url) && !tab.interstitial);

  function showSiteInfo(event: MouseEvent & { currentTarget: HTMLElement }): void {
    const rect = event.currentTarget.getBoundingClientRect();
    api.siteInfo.show({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }

  /** Page options popover (ADR-031), hanging below the whole address bar. */
  let form: HTMLFormElement;
  function showPageOptions(): void {
    const rect = form.getBoundingClientRect();
    api.pageOptions.show({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }

  /** The window's tab recording (ADR-031): always shown while it runs, with its timer. */
  const recording = $derived(browser.state.recording ?? null);
  let now = $state(Date.now());
  $effect(() => {
    if (!recording) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 500);
    return () => clearInterval(timer);
  });

  /** Translation (ADR-036): in view while translating or translated (the offer itself is in the page options). */
  const translation = $derived(tab?.translation ?? null);
  const showTranslate = $derived(!!translation && translation.status !== "idle");
  function showTranslatePanel(event: MouseEvent & { currentTarget: HTMLElement }): void {
    const rect = event.currentTarget.getBoundingClientRect();
    api.translate.show({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }

  /** Width of the floating buttons: the URL fades out under them while they show. */
  let actionsWidth = $state(0);

  /** The URL at rest: the readable host first, then the rest of the address, dimmed. */
  const shown = $derived.by(() => {
    if (!tab || !/^https?:/.test(tab.url) || tab.interstitial) return { host: label, rest: "" };
    const slash = label.indexOf("/");
    return slash < 0 ? { host: label, rest: "" } : { host: label.slice(0, slash), rest: label.slice(slash) };
  });

  export function focus(): void {
    input.focus();
    input.select();
  }

  function onFocus(): void {
    focused = true;
    typed = false;
    selected = 0;
    suggestions = [];
    draft = tab?.url ?? "";
    queueMicrotask(() => input.select());
    // Bookmarks are few: fetch them once per focus and filter locally while typing.
    api.bookmarks.list().then((list) => (bookmarks = list), () => {});
  }

  async function refreshSuggestions(text: string): Promise<void> {
    const id = ++request;
    // Suggestions for older text go right away: Arrow/Enter must never pick one while the new ones load.
    suggestions = [];
    if (!text.trim()) return;
    const history = await api.history.search(text, MAX_SUGGESTIONS + 2).catch(() => []);
    // A newer keystroke already asked for fresher results.
    if (id === request) suggestions = mergeSuggestions(text, history, bookmarks, MAX_SUGGESTIONS);
  }

  function onInput(event: Event & { currentTarget: HTMLInputElement }): void {
    draft = event.currentTarget.value;
    typed = true;
    selected = 0;
    void refreshSuggestions(draft);
  }

  function go(target: string): void {
    if (tab) api.tabs.navigate(tab.id, target);
    else api.tabs.create(target);
    input.blur();
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const suggestion = open && selected > 0 ? suggestions[selected - 1] : undefined;
    go(suggestion ? suggestion.url : draft);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      draft = tab?.url ?? "";
      input.blur();
    } else if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const rows = suggestions.length + 1;
      selected = (selected + (event.key === "ArrowDown" ? 1 : rows - 1)) % rows;
    }
  }
</script>

<div class="omnibox no-drag">
  <!--
    At rest the URL uses the whole bar: host first, path dimmed. Two actions float over its end and
    fade in on hover or keyboard focus (ADR-031, ADR-045): the favorite star and the page options
    ("…": copy, zoom, captures, reader, translation, passwords, QR code). Shields and permissions
    are behind the lock (site info). Active states (zoom, reader on, translated, shields off,
    recording) stay in view, in flow.
  -->
  <form class="address" class:focused onsubmit={submit} bind:this={form}>
    {#if !open && isWebPage}
      <!-- The lock opens the site info popover (connection, cookies, permissions, shields, zoom): the
         one place for the site's settings (ADR-045). -->
      <button
        type="button"
        class="status site-info"
        class:secure={isSecure}
        title="{isSecure ? 'Connexion sécurisée' : 'Connexion non sécurisée'} : infos sur le site, protections ({tab?.shieldsEnabled ? `${tab.blockedCount} bloqué${tab.blockedCount > 1 ? 's' : ''}` : 'désactivées'}) et autorisations"
        aria-label="Infos sur le site ({isSecure ? 'connexion sécurisée' : 'connexion non sécurisée'})"
        onmousedown={(event) => event.preventDefault()}
        onclick={showSiteInfo}
      >
        <Icon name={isSecure ? "lock" : "warning"} size={14} />
      </button>
    {:else}
      <span
        class="status"
        class:secure={!open && isInternal}
        title={open ? undefined : isInternal ? t("addressBar.browserPage") : tab?.url ? t("addressBar.unencryptedConnection") : undefined}
      >
        <!-- While typing, the icon says what Enter will do (search or go), not the current page's security. -->
        <Icon name={open ? (isSearch ? "search" : "globe") : !tab?.url ? "search" : isInternal ? "sparkle" : "warning"} size={14} />
      </span>
    {/if}
    <div class="url" style:--actions-w="{actionsWidth}px">
      <input
        bind:this={input}
        class:masked={!focused && !!label}
        value={focused ? draft : label}
        oninput={onInput}
        onfocus={onFocus}
        onblur={() => (focused = false)}
        onkeydown={onKeydown}
        placeholder={t("addressBar.searchEnterAddress")}
        spellcheck="false"
        autocomplete="off"
        aria-label={t("addressBar.addressBar")}
        role="combobox"
        aria-expanded={open}
        aria-controls="address-suggestions"
        aria-autocomplete="list"
        aria-activedescendant={open ? `suggestion-${selected}` : undefined}
      />
      {#if !focused && label}
        <span class="display" aria-hidden="true" data-testid="address-display"
          ><span class="host">{shown.host}</span>{#if shown.rest}<span class="path">{shown.rest}</span>{/if}</span
        >
      {/if}
      <div class="actions" bind:offsetWidth={actionsWidth}>
        {#if tab?.url && !focused && !isInternal}
          <button
            type="button"
            class="star act"
            class:on={tab.isBookmarked}
            aria-label={tab.isBookmarked ? t("addressBar.removeFromBookmarks") : t("addressBar.addBookmarks")}
            aria-pressed={tab.isBookmarked}
            title={platform.tip(tab.isBookmarked ? t("addressBar.removeFromBookmarks") : t("addressBar.addBookmarks"), "toggle-bookmark")}
            onclick={() => api.bookmarks.toggleActive()}
          >
            <Icon name="star" size={16} filled={tab.isBookmarked} />
          </button>
          {#if isWebPage && !browser.isPrivate}
            <!-- "Lire plus tard" (ADR-047): the page and its reader-mode text, kept for later. -->
            <button
              type="button"
              class="star act"
              class:on={tab.inReadingList}
              aria-label={tab.inReadingList ? t("addressBar.removeFromReadingList") : t("addressBar.readLater")}
              aria-pressed={!!tab.inReadingList}
              title={platform.tip(tab.inReadingList ? t("addressBar.removeFromReadingList") : t("addressBar.readLater"), "toggle-reading-list")}
              onmousedown={(event) => event.preventDefault()}
              onclick={() => void api.reading.toggleTab(tab.id)}
            >
              <Icon name="book-marked" size={16} />
            </button>
          {/if}
          <button
            type="button"
            class="star act"
            aria-label={t("addressBar.pageOptions")}
            aria-haspopup="dialog"
            title={platform.tip(t("addressBar.pageOptions"), "page-options")}
            onmousedown={(event) => event.preventDefault()}
            onclick={showPageOptions}
          >
            <Icon name="more" size={16} />
          </button>
        {/if}
      </div>
    </div>
    {#if tab && zoomed && !focused}
      <button
        type="button"
        class="zoom"
        title={t("addressBar.zoomSiteClickGo", { zoom: tab.zoom, defaultZoom, p: platform.shortcut('zoom-reset') })}
        aria-label={t("addressBar.zoomBack", { zoom: tab.zoom, defaultZoom })}
        onclick={() => api.commands.run("zoom-reset")}
      >
        {tab.zoom}&#8239;%
      </button>
    {/if}
    {#if extensionsUi.storeCandidate && !focused}
      <!-- A Chrome Web Store extension page (ADR-049): install it here too (our button in the page does the same). -->
      {@const install = extensionsUi.pageInstall}
      {@const phase = extensionsUi.phaseLabel(install)}
      <button
        type="button"
        class="star on"
        class:busy={!!phase}
        aria-label={phase ?? (install?.phase === "error" ? t("addressBar.retryAddingBrowser") : t("addressBar.addBrowser"))}
        title={phase ?? (install?.phase === "error" ? t("addressBar.clickTryAgain", { message: install.message }) : t("addressBar.addExtensionBrowser"))}
        data-store-phase={install?.phase ?? "idle"}
        disabled={!!phase}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => extensionsUi.storeCandidate && extensionsUi.installFromStore(extensionsUi.storeCandidate)}
      >
        <Icon name={phase ? "loader" : install?.phase === "error" ? "warning" : "extension"} size={16} />
      </button>
    {/if}
    {#if tab?.reader && isWebPage && !focused}
      <!-- Reader mode on (ADR-026): one click back to the page. It is turned on from the page options. -->
      <button
        type="button"
        class="star on"
        aria-pressed="true"
        aria-label={t("addressBar.exitReaderMode")}
        title={platform.tip(t("addressBar.exitReaderMode"), "toggle-reader")}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => api.commands.run("toggle-reader")}
      >
        <Icon name="reader" size={16} />
      </button>
    {/if}
    {#if showTranslate && isWebPage && !focused}
      <!-- Translating or translated (ADR-036): its popover (original, languages, rules). -->
      <button
        type="button"
        class="star on"
        aria-label={tab?.translated ? t("addressBar.pageTranslated") : t("addressBar.pageTranslation")}
        title={platform.tip(tab?.translated ? "Page traduite" : t("addressBar.pageTranslation"), "translate-page")}
        onmousedown={(event) => event.preventDefault()}
        onclick={showTranslatePanel}
      >
        <Icon name="languages" size={16} />
      </button>
    {/if}
    {#if tab && showShield && !tab.shieldsEnabled && !focused}
      <!-- Shields off on this site: in view, struck out; one click turns them back on. -->
      <button
        type="button"
        class="star shield-off"
        title={shieldTitle}
        aria-label={shieldTitle}
        aria-pressed="false"
        onclick={() => tab && api.tabs.toggleShields(tab.id)}
      >
        <Icon name="shield-off" size={14} />
      </button>
    {/if}
    {#if recording}
      <!-- Always visible while the window records a tab: red dot, timer, stop. -->
      <span class="recording" role="status" aria-label={t("addressBar.recording", { p: formatDuration(now - recording.startedAt) })}>
        <span class="dot" aria-hidden="true"></span>
        <span class="time" aria-hidden="true">{formatDuration(now - recording.startedAt)}</span>
        <button
          type="button"
          class="stop"
          aria-label={t("addressBar.stopRecording")}
          title={platform.tip(t("addressBar.stopRecording"), "record-video")}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => api.commands.run("record-video")}
        >
          <Icon name="stop-recording" size={14} />
        </button>
      </span>
    {/if}
  </form>

  {#if open}
    <SuggestionList {query} {isSearch} {suggestions} {selected} onGo={(target) => go(target ?? draft)} />
  {/if}
</div>

<style>
  .omnibox {
    --recording: var(--danger, #e5484d);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .address {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: var(--control-height);
    padding: 0 4px 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: var(--surface);
    transition:
      background var(--motion-fast) var(--ease),
      border-color var(--motion-fast) var(--ease),
      box-shadow var(--motion-fast) var(--ease);
  }
  .address:hover {
    background: var(--surface-hover);
  }
  /* The URL's box: the input, the at-rest display over it, and the floating buttons. */
  .url {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    align-self: stretch;
    min-width: 0;
  }
  .display {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
    pointer-events: none;
    font-size: 13px;
    /* Fades the end of the URL out: 16px at rest (long URLs), under the buttons while they show. */
    mask-image: linear-gradient(to left, transparent var(--url-fade), #000 calc(var(--url-fade) + 16px));
    transition: --url-fade var(--motion-fast) var(--ease);
  }
  .host {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-weight: 500;
  }
  /* The path gives way first: the host stays readable as long as it fits. */
  .path {
    flex: 0 1000 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
  }
  input.masked {
    color: transparent;
  }
  .actions {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  /* Hidden until the bar is hovered or holds the keyboard focus (a click is always a hover). */
  .actions .act {
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease);
  }
  .address:hover .act,
  .address:focus-within .act {
    opacity: 1;
  }
  .address:hover .display,
  .address:focus-within .display {
    --url-fade: var(--actions-w);
  }
  /* While typing, the text stops before the buttons still shown (shields). */
  .focused input {
    padding-right: var(--actions-w);
  }
  .recording {
    display: flex;
    flex: none;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 2px 0 7px;
    border-radius: 11px;
    background: color-mix(in oklab, var(--recording) 16%, transparent);
    color: var(--text);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .recording .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--recording);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .recording .stop {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 10px;
    color: var(--recording);
  }
  .recording .stop:hover {
    background: var(--surface-active);
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .recording .dot {
      animation: none;
    }
  }
  .address.focused {
    border-color: var(--accent-text);
    background: var(--bg-elevated);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 20%, transparent);
  }
  .status {
    display: grid;
    flex: none;
    color: var(--text-faint);
  }
  .status.secure {
    color: var(--text-muted);
  }
  .site-info {
    place-items: center;
    width: var(--hit-min);
    height: var(--hit-min);
    margin-left: -6px;
    border-radius: var(--radius-sm);
    transition: background var(--motion-fast) var(--ease);
  }
  .site-info:hover {
    background: var(--surface-active);
    color: var(--text);
  }
  .omnibox {
    position: relative;
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font-size: 13px;
    user-select: text;
  }
  input::placeholder {
    color: var(--text-faint);
  }
  .zoom {
    flex: none;
    height: 22px;
    padding: 0 7px;
    border-radius: 11px;
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--accent-text);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .zoom:hover {
    background: color-mix(in oklab, var(--accent) 26%, transparent);
  }
  .star {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--hit-min);
    height: var(--hit-min);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }
  .star:hover {
    background: var(--surface-active);
    color: var(--text);
  }
  .star.on {
    color: var(--accent-text);
  }
  .star.busy :global(svg) {
    animation: spin calc(var(--motion-base) * 4) linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(1turn);
    }
  }
  .shield-off {
    color: var(--text-faint);
  }
  /* Narrow sidebar: tighter spacing. */
  @container sidebar (max-width: 230px) {
    .address {
      gap: 4px;
    }
  }
</style>
