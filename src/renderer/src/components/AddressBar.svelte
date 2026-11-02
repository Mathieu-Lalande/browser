<script lang="ts">
  import { mergeSuggestions, type Suggestion } from "@shared/search";
  import { internalPageOf } from "@shared/internal";
  import type { Bookmark } from "@shared/types";
  import { displayUrl, normalizeInput, searchUrl } from "@shared/url";
  import { formatDuration } from "@shared/capture";
  import { api, browser } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import { settings } from "../lib/settings.svelte";
  import Favicon from "./Favicon.svelte";
  import Icon from "./Icon.svelte";

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
  const zoomed = $derived(!!tab && /^https?:|^data:/.test(tab.url) && !tab.interstitial && tab.zoom !== defaultZoom);

  const showShield = $derived(!!tab && /^https?:/.test(tab.url) && !tab.interstitial);
  const shieldTitle = $derived(
    tab?.shieldsEnabled
      ? `Protections activées : ${tab.blockedCount} élément${tab.blockedCount > 1 ? "s" : ""} bloqué${tab.blockedCount > 1 ? "s" : ""}. Cliquer pour les désactiver sur ce site.`
      : "Protections désactivées sur ce site. Cliquer pour les réactiver.",
  );

  /** Web pages get the site info popover and the copy-link button. */
  const isWebPage = $derived(!!tab && /^https?:/.test(tab.url) && !tab.interstitial);

  /** "Lien copié" confirmation, shown for a moment after copying. */
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  function copyLink(): void {
    api.commands.run("copy-url");
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1600);
  }

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

  function showPasswords(event: MouseEvent & { currentTarget: HTMLElement }): void {
    const rect = event.currentTarget.getBoundingClientRect();
    api.passwords.showFill({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }

  // Another page: the confirmation was about the previous one.
  $effect(() => {
    void tab?.url;
    copied = false;
  });

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

{#snippet readerButton()}
  <!-- Reader mode (ADR-026): offered when Readability thinks the page is an article; kept in view while on. -->
  <button
    type="button"
    class="star act"
    class:on={tab?.reader}
    class:keep={tab?.reader}
    aria-pressed={!!tab?.reader}
    aria-label={tab?.reader ? "Quitter le mode lecture" : "Mode lecture"}
    title={platform.tip(tab?.reader ? "Quitter le mode lecture" : "Mode lecture", "toggle-reader")}
    onmousedown={(event) => event.preventDefault()}
    onclick={() => api.commands.run("toggle-reader")}
  >
    <Icon name="reader" size={16} />
  </button>
{/snippet}

{#snippet shieldButton()}
  {#if tab}
    <!-- Shields: a hover action while on, kept in view (struck out) while off on this site. -->
    <button
      type="button"
      class="shield act"
      class:off={!tab.shieldsEnabled}
      class:keep={!tab.shieldsEnabled}
      title={shieldTitle}
      aria-label={shieldTitle}
      aria-pressed={tab.shieldsEnabled}
      onclick={() => tab && api.tabs.toggleShields(tab.id)}
    >
      <Icon name={tab.shieldsEnabled ? "shield" : "shield-off"} size={14} />
      {#if tab.shieldsEnabled && tab.blockedCount > 0}<span class="count">{tab.blockedCount > 99 ? "99+" : tab.blockedCount}</span>{/if}
    </button>
  {/if}
{/snippet}

<div class="omnibox no-drag">
  <!--
    At rest the URL uses the whole bar: host first, path dimmed. The action buttons float over its
    end and fade in on hover or keyboard focus (ADR-031), over a fade-out of the URL, which never
    moves. Buttons showing an active state (reader on, shields off, zoom, recording) stay, in flow.
  -->
  <form class="address" class:focused onsubmit={submit} bind:this={form}>
    {#if !open && isWebPage}
      <!-- The lock opens the site info popover (connection, cookies, permissions, shields, zoom). -->
      <button
        type="button"
        class="status site-info"
        class:secure={isSecure}
        title="{isSecure ? 'Connexion sécurisée' : 'Connexion non sécurisée'} : infos sur le site"
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
        title={open ? undefined : isInternal ? "Page du navigateur" : tab?.url ? "Connexion non chiffrée" : undefined}
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
        placeholder="Rechercher ou saisir une adresse"
        spellcheck="false"
        autocomplete="off"
        aria-label="Barre d'adresse"
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
        {#if (tab?.readerable || tab?.reader) && isWebPage && !focused && !tab.reader}
          {@render readerButton()}
        {/if}
        {#if tab?.hasPasswords && isWebPage && !focused}
          <!-- Saved passwords for this site (ADR-025): choose an account to fill the login form. -->
          <button
            type="button"
            class="star act"
            aria-label="Remplir un mot de passe enregistré"
            title="Remplir un mot de passe enregistré"
            onmousedown={(event) => event.preventDefault()}
            onclick={showPasswords}
          >
            <Icon name="key" size={16} />
          </button>
        {/if}
        {#if tab?.url && !focused && !isInternal}
          <button
            type="button"
            class="star copy act"
            class:done={copied}
            aria-label={copied ? "Lien copié" : "Copier le lien"}
            title={copied ? "Lien copié" : platform.tip("Copier le lien", "copy-url")}
            onclick={copyLink}
          >
            {#key copied}
              <span class="glyph"><Icon name={copied ? "check" : "link"} size={16} /></span>
            {/key}
          </button>
          <button
            type="button"
            class="star act"
            class:on={tab.isBookmarked}
            aria-label={tab.isBookmarked ? "Retirer des favoris" : "Ajouter aux favoris"}
            aria-pressed={tab.isBookmarked}
            title={platform.tip(tab.isBookmarked ? "Retirer des favoris" : "Ajouter aux favoris", "toggle-bookmark")}
            onclick={() => api.bookmarks.toggleActive()}
          >
            <Icon name="star" size={16} filled={tab.isBookmarked} />
          </button>
        {/if}
        {#if tab && showShield && tab.shieldsEnabled}
          {@render shieldButton()}
        {/if}
        {#if tab?.url && !focused && !isInternal}
          <button
            type="button"
            class="star act more"
            aria-label="Options de la page"
            aria-haspopup="dialog"
            title={platform.tip("Options de la page", "page-options")}
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
        title="Zoom de ce site : {tab.zoom} %. Cliquer pour revenir à {defaultZoom} % ({platform.shortcut('zoom-reset')})."
        aria-label="Zoom {tab.zoom} %, revenir à {defaultZoom} %"
        onclick={() => api.commands.run("zoom-reset")}
      >
        {tab.zoom}&#8239;%
      </button>
    {/if}
    {#if tab?.reader && isWebPage && !focused}
      {@render readerButton()}
    {/if}
    {#if tab && showShield && !tab.shieldsEnabled}
      {@render shieldButton()}
    {/if}
    {#if recording}
      <!-- Always visible while the window records a tab: red dot, timer, stop. -->
      <span class="recording" role="status" aria-label="Enregistrement en cours : {formatDuration(now - recording.startedAt)}">
        <span class="dot" aria-hidden="true"></span>
        <span class="time" aria-hidden="true">{formatDuration(now - recording.startedAt)}</span>
        <button
          type="button"
          class="stop"
          aria-label="Arrêter l'enregistrement"
          title={platform.tip("Arrêter l'enregistrement", "record-video")}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => api.commands.run("record-video")}
        >
          <Icon name="stop-recording" size={14} />
        </button>
      </span>
    {/if}
  </form>
  <!-- Announced to screen readers; shown as a small note under the address bar (never over the page). -->
  <div class="copied" class:visible={copied} role="status" aria-live="polite">{copied ? "Lien copié" : ""}</div>

  {#if open}
    <!-- Rendered in the sidebar flow (not as an overlay): nothing can be drawn above the page view. -->
    <!-- Options are driven from the keyboard by the combobox input (aria-activedescendant). -->
    <ul class="suggestions" id="address-suggestions" role="listbox" aria-label="Suggestions">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        id="suggestion-0"
        role="option"
        aria-selected={selected === 0}
        class:selected={selected === 0}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => go(draft)}
      >
        <span class="icon"><Icon name={isSearch ? "search" : "globe"} size={16} /></span>
        <span class="text">
          <span class="title"
            >{#if isSearch}Rechercher « {query} »{:else}Aller à {displayUrl(normalizeInput(query, settings.engine))}{/if}</span
          >
        </span>
      </li>
      {#each suggestions as suggestion, index (suggestion.url)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="suggestion-{index + 1}"
          role="option"
          aria-selected={selected === index + 1}
          class:selected={selected === index + 1}
          title={suggestion.url}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => go(suggestion.url)}
        >
          <span class="icon"><Favicon src={suggestion.favicon} /></span>
          <span class="text">
            <span class="title">{suggestion.title || displayUrl(suggestion.url)}</span>
            <span class="url">{displayUrl(suggestion.url)}</span>
          </span>
          {#if suggestion.kind === "bookmark"}
            <span class="kind" title="Favori"><Icon name="star" size={12} filled /></span>
          {/if}
        </li>
      {/each}
    </ul>
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
  /* Hidden (and not clickable) until the bar is hovered or holds the keyboard focus. */
  .actions .act {
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--motion-fast) var(--ease);
  }
  .address:hover .act,
  .address:focus-within .act,
  .act.keep {
    opacity: 1;
    pointer-events: auto;
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
  .copy.done {
    color: var(--accent-text);
  }
  .copy .glyph {
    display: grid;
  }
  .copy.done .glyph {
    animation: check-pop var(--motion-base) var(--ease);
  }
  .copied {
    position: absolute;
    top: calc(var(--control-height) + 4px);
    right: 4px;
    z-index: 2;
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--bg-elevated);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text);
    font-size: 11px;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-3px);
    transition:
      opacity var(--motion-fast) var(--ease),
      transform var(--motion-fast) var(--ease);
  }
  .copied.visible {
    opacity: 1;
    transform: none;
  }
  @keyframes check-pop {
    from {
      opacity: 0;
      transform: scale(0.4) rotate(-20deg);
    }
    60% {
      transform: scale(1.2);
    }
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
  .shield {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-width: var(--hit-min);
    height: var(--hit-min);
    padding: 0 6px;
    border-radius: var(--radius-sm);
    color: var(--accent-text);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .shield:hover {
    background: var(--surface-hover);
  }
  .shield.off {
    color: var(--text-faint);
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
  .suggestions {
    margin: 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
    animation: drop var(--motion-fast) var(--ease);
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 4px 8px;
    border-radius: 7px;
    color: var(--text-muted);
  }
  li.selected {
    background: color-mix(in oklab, var(--accent) 18%, transparent);
    color: var(--text);
  }
  li:hover:not(.selected) {
    background: var(--surface-hover);
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .title,
  .url {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title {
    color: var(--text);
  }
  .url {
    color: var(--text-faint);
    font-size: 11px;
  }
  .kind {
    display: grid;
    color: var(--accent-text);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
  /* Narrow sidebar: tighter spacing, and the copy button (Ctrl+Maj+C, palette) leaves the URL room. */
  @container sidebar (max-width: 230px) {
    .address {
      gap: 4px;
    }
    .copy:not(.done) {
      display: none;
    }
  }
</style>
