<script lang="ts">
  import type { HistoryEntry } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../lib/browser.svelte";
  import Favicon from "./Favicon.svelte";
  import Icon from "./Icon.svelte";

  let query = $state("");
  let topSites = $state<HistoryEntry[]>([]);

  // The start page is mounted each time it shows, so this stays fresh without a subscription.
  $effect(() => {
    api.history.topSites(8).then((sites) => (topSites = sites), () => {});
  });
  let now = $state(new Date());

  $effect(() => {
    const timer = setInterval(() => (now = new Date()), 10_000);
    return () => clearInterval(timer);
  });

  const time = $derived(now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
  const greeting = $derived(now.getHours() < 5 || now.getHours() >= 18 ? "Bonsoir" : "Bonjour");

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const id = browser.state.activeTabId;
    if (query.trim() && id) api.tabs.navigate(id, query);
  }

  function openSite(url: string): void {
    const id = browser.state.activeTabId;
    if (id) api.tabs.navigate(id, url);
  }
</script>

<section class="start">
  <p class="time">{time}</p>
  <h1>{greeting}.</h1>
  <form class="search" onsubmit={submit}>
    <Icon name="search" size={18} />
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={query} placeholder="Rechercher sur le web ou saisir une adresse" spellcheck="false" autofocus />
  </form>
  {#if topSites.length}
    <nav class="sites" aria-label="Sites les plus visités">
      {#each topSites as site (site.url)}
        <button class="site" title={site.url} onclick={() => openSite(site.url)}>
          <span class="tile"><Favicon src={site.favicon} /></span>
          <span class="name">{site.title || displayUrl(site.url)}</span>
        </button>
      {/each}
    </nav>
  {/if}
  <p class="hint"><kbd>Ctrl</kbd> <kbd>L</kbd> barre d'adresse · <kbd>Ctrl</kbd> <kbd>T</kbd> nouvel onglet · <kbd>Ctrl</kbd> <kbd>S</kbd> barre latérale</p>
</section>

<style>
  .start {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 100%;
    padding: 24px;
    animation: rise 0.4s var(--ease);
  }
  .time {
    margin: 0;
    color: var(--text-faint);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.08em;
  }
  h1 {
    margin: 0 0 22px;
    font-size: clamp(32px, 5vw, 52px);
    font-weight: 600;
    letter-spacing: -0.04em;
    background: linear-gradient(120deg, var(--text) 30%, var(--accent) 70%, var(--accent-2));
    background-clip: text;
    color: transparent;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 12px;
    width: min(620px, 100%);
    height: 52px;
    padding: 0 18px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg-elevated);
    color: var(--text-faint);
    box-shadow: 0 20px 60px -20px color-mix(in oklab, var(--accent) 45%, transparent);
  }
  .search:focus-within {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
  }
  .search input {
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-size: 16px;
    user-select: text;
  }
  .sites {
    display: grid;
    grid-template-columns: repeat(auto-fill, 88px);
    justify-content: center;
    gap: 10px;
    width: min(620px, 100%);
    margin-top: 22px;
  }
  .site {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px 4px;
    border-radius: 12px;
    color: var(--text-muted);
  }
  .site:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .tile {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .name {
    width: 100%;
    overflow: hidden;
    font-size: 12px;
    text-align: center;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .hint {
    margin-top: 18px;
    color: var(--text-faint);
    font-size: 12px;
  }
  kbd {
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font: inherit;
    font-size: 11px;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
