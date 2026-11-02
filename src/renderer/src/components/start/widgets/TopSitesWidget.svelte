<script lang="ts">
  import type { HistoryEntry } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { api } from "../../../lib/browser.svelte";
  import Favicon from "../../Favicon.svelte";
  import Icon from "../../Icon.svelte";
  import { openHere, type WidgetProps } from "../types";

  let { widget }: WidgetProps<"top-sites"> = $props();
  let visited = $state<HistoryEntry[]>([]);

  // The page is mounted each time it shows, so this stays fresh without a subscription.
  $effect(() => {
    api.history.topSites(12).then((sites) => (visited = sites), () => {});
  });

  /** Pinned sites first, then the most visited ones not pinned, up to `count`. */
  const sites = $derived.by(() => {
    const pins = widget.options.pins.map((pin) => ({ url: pin.url, title: pin.title, favicon: null as string | null, pinned: true }));
    const pinned = new Set(pins.map((pin) => pin.url));
    const rest = visited.filter((site) => !pinned.has(site.url)).map((site) => ({ url: site.url, title: site.title, favicon: site.favicon, pinned: false }));
    return [...pins, ...rest].slice(0, widget.options.count);
  });
</script>

{#if sites.length}
  <nav class="sites" aria-label="Sites les plus visités">
    {#each sites as site (site.url)}
      <button class="site" title={site.url} onclick={() => openHere(site.url)}>
        <span class="tile">
          <Favicon src={site.favicon} />
          {#if site.pinned}<span class="pin"><Icon name="pin" size={10} /></span>{/if}
        </span>
        <span class="name">{site.title || displayUrl(site.url)}</span>
      </button>
    {/each}
  </nav>
{:else}
  <p class="empty">Les sites que vous visitez souvent apparaîtront ici.</p>
{/if}

<style>
  .sites {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }
  .site {
    display: flex;
    width: 88px;
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
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .pin {
    position: absolute;
    top: -5px;
    right: -5px;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
  }
  .name {
    width: 100%;
    overflow: hidden;
    font-size: 12px;
    text-align: center;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .empty {
    margin: 0;
    color: var(--text-faint);
    font-size: 13px;
    text-align: center;
  }
</style>
