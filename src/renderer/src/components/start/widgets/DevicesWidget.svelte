<script lang="ts">
  import { displayUrl } from "@shared/url";
  import { sync } from "../../../lib/sync.svelte";
  import Icon from "../../Icon.svelte";
  import { openHere, type WidgetProps } from "../types";

  let { widget }: WidgetProps<"devices"> = $props();
  const devices = $derived((sync.status?.devices ?? []).filter((device) => device.tabs.length > 0));
</script>

<h2 class="widget-title">Autres appareils</h2>
{#if devices.length}
  <div class="devices">
    {#each devices as device (device.id)}
      <section>
        <h3><Icon name={device.kind === "mobile" ? "smartphone" : "laptop"} size={14} /> {device.name}</h3>
        <ul>
          {#each device.tabs.slice(0, widget.options.count) as tab, index (index)}
            <li><button title={tab.url} onclick={() => openHere(tab.url)}>{tab.title || displayUrl(tab.url)}</button></li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{:else}
  <p class="widget-empty">
    {sync.status?.configured ? "Aucun onglet ouvert sur vos autres appareils." : "Activez la synchronisation dans les paramètres pour retrouver ici les onglets de vos autres appareils."}
  </p>
{/if}

<style>
  .devices {
    display: grid;
    gap: 10px;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 4px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
  }
  ul {
    display: grid;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  button {
    width: 100%;
    overflow: hidden;
    padding: 5px 8px;
    border-radius: 8px;
    color: var(--text);
    font-size: 13px;
    text-align: left;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  button:hover {
    background: var(--surface-hover);
  }
</style>
