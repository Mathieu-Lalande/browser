<script lang="ts">
  import type { TabState } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { api } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import Icon from "./Icon.svelte";
  import TabIcon from "./TabIcon.svelte";

  /**
   * One tab of the vertical tab list. Keyboard: a single Tab stop for the whole list (roving
   * `tabindex`, handled by the list in Sidebar.svelte); its buttons are for the pointer, the
   * keyboard closes a tab with Delete and mutes it with the registry shortcut.
   */
  let { tab, active, focusable = active }: { tab: TabState; active: boolean; focusable?: boolean } = $props();

  /** Title, then the address on a second line. */
  const tooltip = $derived(tab.url && tab.url !== tab.title ? `${tab.title}\n${displayUrl(tab.url)}` : tab.title);

  function onAuxClick(event: MouseEvent): void {
    if (event.button === 1) api.tabs.close(tab.id);
  }
</script>

<!-- Keyboard: handled by the tab list (arrows, Enter/Space, Delete), see Sidebar.svelte. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="tab"
  class:active
  class:asleep={tab.isAsleep}
  role="tab"
  tabindex={focusable ? 0 : -1}
  aria-selected={active}
  data-tab-id={tab.id}
  title={tooltip}
  onclick={() => api.tabs.activate(tab.id)}
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
      tabindex="-1"
      aria-label={tab.isMuted ? "Réactiver le son de l'onglet" : "Couper le son de l'onglet"}
      aria-pressed={tab.isMuted}
      title={platform.tip(tab.isMuted ? "Réactiver le son" : "Couper le son", "toggle-mute")}
      onclick={(event) => (event.stopPropagation(), api.tabs.toggleMute(tab.id))}
    >
      <Icon name={tab.isMuted ? "volume-off" : "volume"} size={12} />
    </button>
  {/if}
  <button
    class="close"
    tabindex="-1"
    aria-label="Fermer l'onglet"
    title={platform.tip("Fermer l'onglet", "close-tab")}
    onclick={(event) => (event.stopPropagation(), api.tabs.close(tab.id))}
  >
    <Icon name="close" size={12} />
  </button>
</div>

<style>
  .tab {
    position: relative;
    display: flex;
    flex: none;
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
  /* Inside the scrolling list: an inset ring is never clipped. */
  .tab:focus-visible {
    outline-offset: -2px;
  }
  .tab.active {
    background: var(--tab-active-bg, var(--bg-elevated));
    color: var(--text);
    box-shadow:
      var(--elevation),
      inset 0 0 0 1px var(--border);
  }
  /* A small accent bar: the active tab never reads as a hovered one, in either theme. */
  .tab.active::before {
    position: absolute;
    top: 50%;
    left: 3px;
    width: 3px;
    height: 14px;
    border-radius: 2px;
    background: var(--accent-text);
    transform: translateY(-50%);
    content: "";
  }
  /* Asleep (page unloaded, reloads when activated, ADR-014): dimmed. */
  .tab.asleep:not(.active) .title {
    color: var(--text-faint);
  }
  .tab.asleep:not(.active) > :global(:first-child) {
    opacity: 0.5;
    filter: grayscale(0.7);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* Fixed size: on a narrow sidebar the title gives way, never the close button. */
  .close {
    display: grid;
    flex: none;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    color: var(--text-faint);
    opacity: 0.6;
  }
  /* Always there to close any tab; full strength on the active or hovered one. */
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
