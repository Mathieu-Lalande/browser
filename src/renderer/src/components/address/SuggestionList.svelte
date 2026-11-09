<script lang="ts">
  import { t } from "@shared/i18n";
  import type { Suggestion } from "@shared/search";
  import { displayUrl, normalizeInput } from "@shared/url";
  import { settings } from "../../lib/settings.svelte";
  import Favicon from "../Favicon.svelte";
  import Icon from "../Icon.svelte";

  /**
   * The address bar's suggestions: first the "search for / go to" row (`selected` 0), then the
   * history and bookmark matches. Rendered in the sidebar flow (not as an overlay): nothing can be
   * drawn above the page view. Options are driven from the keyboard by the combobox input
   * (aria-activedescendant `suggestion-<n>`).
   */
  let {
    query,
    isSearch,
    suggestions,
    selected,
    onGo,
  }: { query: string; isSearch: boolean; suggestions: Suggestion[]; selected: number; onGo: (target: string | null) => void } = $props();
</script>

<ul class="suggestions" id="address-suggestions" role="listbox" aria-label={t("suggestionList.suggestions")}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <li
    id="suggestion-0"
    role="option"
    aria-selected={selected === 0}
    class:selected={selected === 0}
    onmousedown={(event) => event.preventDefault()}
    onclick={() => onGo(null)}
  >
    <span class="icon"><Icon name={isSearch ? "search" : "globe"} size={16} /></span>
    <span class="text">
      <span class="title"
        >{#if isSearch}{t("suggestionList.search", { query })}{:else}{t("suggestionList.go", { p: displayUrl(normalizeInput(query, settings.engine)) })}{/if}</span
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
      onclick={() => onGo(suggestion.url)}
    >
      <span class="icon"><Favicon src={suggestion.favicon} /></span>
      <span class="text">
        <span class="title">{suggestion.title || displayUrl(suggestion.url)}</span>
        <span class="url">{displayUrl(suggestion.url)}</span>
      </span>
      {#if suggestion.kind === "bookmark"}
        <span class="kind" title={t("suggestionList.bookmark")}><Icon name="star" size={12} filled /></span>
      {/if}
    </li>
  {/each}
</ul>

<style>
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
  /* The box rules the address bar's own `.url` gave these lines when they lived there (kept as is). */
  .url {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    align-self: stretch;
    min-width: 0;
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
</style>
