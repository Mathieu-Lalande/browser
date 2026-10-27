<script lang="ts">
  import { mergeSuggestions, type Suggestion } from "@shared/search";
  import { internalPageOf } from "@shared/internal";
  import type { Bookmark } from "@shared/types";
  import { displayUrl, normalizeInput, searchUrl } from "@shared/url";
  import { api, browser } from "../lib/browser.svelte";
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
    if (!text.trim()) {
      suggestions = [];
      return;
    }
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
  <form class="address" class:focused onsubmit={submit}>
    <span
      class="status"
      class:secure={isSecure || isInternal}
      title={isInternal ? "Page du navigateur" : isSecure ? "Connexion sécurisée" : undefined}
    >
      <Icon name={!tab?.url ? "search" : isInternal ? "sparkle" : isSecure ? "lock" : "warning"} size={12} />
    </span>
    <input
      bind:this={input}
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
    {#if tab && zoomed && !focused}
      <button
        type="button"
        class="zoom"
        title="Zoom de ce site : {tab.zoom} %. Cliquer pour revenir à {defaultZoom} % (Ctrl+0)."
        aria-label="Zoom {tab.zoom} %, revenir à {defaultZoom} %"
        onclick={() => api.commands.run("zoom-reset")}
      >
        {tab.zoom} %
      </button>
    {/if}
    {#if tab?.url && !focused && !isInternal}
      <button
        type="button"
        class="star"
        class:on={tab.isBookmarked}
        aria-label={tab.isBookmarked ? "Retirer des favoris" : "Ajouter aux favoris"}
        aria-pressed={tab.isBookmarked}
        title={tab.isBookmarked ? "Retirer des favoris (Ctrl+D)" : "Ajouter aux favoris (Ctrl+D)"}
        onclick={() => api.bookmarks.toggleActive()}
      >
        <Icon name="star" size={16} filled={tab.isBookmarked} />
      </button>
    {/if}
    {#if tab && showShield}
      <button
        type="button"
        class="shield"
        class:off={!tab.shieldsEnabled}
        title={shieldTitle}
        aria-label={shieldTitle}
        aria-pressed={tab.shieldsEnabled}
        onclick={() => tab && api.tabs.toggleShields(tab.id)}
      >
        <Icon name={tab.shieldsEnabled ? "shield" : "shield-off"} size={12} />
        {#if tab.shieldsEnabled && tab.blockedCount > 0}<span class="count">{tab.blockedCount > 99 ? "99+" : tab.blockedCount}</span>{/if}
      </button>
    {/if}
  </form>

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
          {#if isSearch}Rechercher « {query} »{:else}Aller à {displayUrl(normalizeInput(query, settings.engine))}{/if}
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
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .address {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--control-height);
    padding: 0 6px 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: var(--surface);
    transition:
      background 0.15s var(--ease),
      border-color 0.15s var(--ease),
      box-shadow 0.15s var(--ease);
  }
  .address:hover {
    background: var(--surface-hover);
  }
  .address.focused {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
    background: var(--bg-elevated);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 20%, transparent);
  }
  .status {
    display: grid;
    color: var(--text-faint);
  }
  .status.secure {
    color: var(--text-muted);
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
    gap: 3px;
    height: 24px;
    margin-right: -4px;
    padding: 0 6px;
    border-radius: 7px;
    color: var(--accent);
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
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-faint);
  }
  .star:hover {
    background: var(--surface-active);
    color: var(--text);
  }
  .star.on {
    color: var(--accent);
  }
  .suggestions {
    margin: 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
    animation: drop 0.12s var(--ease);
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
    color: var(--accent);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
</style>
