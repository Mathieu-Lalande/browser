<script lang="ts">
  import { t } from "@shared/i18n";
  import { displayUrl } from "@shared/url";
  import { sync } from "../../../lib/sync.svelte";
  import Icon from "../../Icon.svelte";
  import { openHere, type WidgetProps } from "../types";

  let { widget }: WidgetProps<"devices"> = $props();
  const devices = $derived((sync.status?.devices ?? []).filter((device) => device.tabs.length > 0));
</script>

<h2 class="widget-title">{t("devicesWidget.otherDevices")}</h2>
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
    {sync.status?.configured ? t("devicesWidget.noTabsOpenOther") : t("devicesWidget.turnSyncSettingsFind")}
  </p>
{/if}

<style>
  .devices {
    display: grid;
    gap: var(--space-3);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
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
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: var(--text-sm);
    text-align: left;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  button:hover {
    background: var(--surface-hover);
  }
</style>
