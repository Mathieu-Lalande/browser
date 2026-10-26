<script lang="ts">
  import type { TabState } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import Icon from "./Icon.svelte";
  import TabIcon from "./TabIcon.svelte";

  let { tab, active }: { tab: TabState; active: boolean } = $props();

  function onAuxClick(event: MouseEvent): void {
    if (event.button === 1) api.tabs.close(tab.id);
  }
</script>

<div
  class="tab"
  class:active
  role="tab"
  tabindex="0"
  aria-selected={active}
  title={tab.url || tab.title}
  onclick={() => api.tabs.activate(tab.id)}
  onkeydown={(event) => event.key === "Enter" && api.tabs.activate(tab.id)}
  onauxclick={onAuxClick}
  ondblclick={() => api.tabs.togglePin(tab.id)}
  oncontextmenu={(event) => (event.preventDefault(), api.tabs.contextMenu(tab.id))}
>
  <TabIcon {tab} />
  <span class="title">{tab.title}</span>
  {#if tab.isAudible || tab.isMuted}
    <button
      class="audio"
      class:muted={tab.isMuted}
      aria-label={tab.isMuted ? "Réactiver le son de l'onglet" : "Couper le son de l'onglet"}
      aria-pressed={tab.isMuted}
      title={tab.isMuted ? "Réactiver le son (Ctrl+M)" : "Couper le son (Ctrl+M)"}
      onclick={(event) => (event.stopPropagation(), api.tabs.toggleMute(tab.id))}
    >
      <Icon name={tab.isMuted ? "volume-off" : "volume"} size={13} />
    </button>
  {/if}
  <button class="close" aria-label="Fermer l'onglet" onclick={(event) => (event.stopPropagation(), api.tabs.close(tab.id))}>
    <Icon name="close" size={12} />
  </button>
</div>

<style>
  .tab {
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--tab-height);
    padding: 0 6px 0 10px;
    border-radius: var(--radius);
    color: var(--text-muted);
    transition: background 0.12s var(--ease);
  }
  .tab:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .tab.active {
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow:
      var(--elevation),
      inset 0 0 0 1px var(--border);
  }
  .title {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .close {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    color: var(--text-faint);
    opacity: 0;
  }
  .tab:hover .close,
  .tab.active .close {
    opacity: 1;
  }
  .audio {
    display: grid;
    flex: none;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-right: -6px;
    border-radius: 6px;
    color: var(--accent-text);
  }
  .audio.muted {
    color: var(--text-faint);
  }
  .audio:hover {
    background: var(--surface-active);
    color: var(--text);
  }
  .close:hover {
    background: var(--surface-active);
    color: var(--text);
  }
</style>
