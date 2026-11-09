<script lang="ts">
  import { panelLabel } from "@shared/panels";
  import { platform } from "../../lib/platform.svelte";
  import { api } from "../../lib/browser.svelte";
  import { panelsUi } from "../../lib/panels.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import PanelIcon from "./PanelIcon.svelte";

  /**
   * The web panels pinned to the sidebar (ADR-047): one icon per panel (its unread count from the
   * page title as a badge), "+" to add one. A click shows the panel beside the page or hides it;
   * a right click opens its menu (reload, mobile version, move, remove). `vertical`: the compact rail.
   */
  let { vertical = false }: { vertical?: boolean } = $props();

  const openId = $derived(panelsUi.open?.id ?? null);
</script>

{#if panelsUi.available}
  <div class="strip" class:vertical role="toolbar" aria-label="Panneaux web" aria-orientation={vertical ? "vertical" : "horizontal"} data-testid="panel-strip">
    {#each panelsUi.list as panel (panel.id)}
      {@const label = panelLabel(panel)}
      <button
        type="button"
        class="panel"
        class:open={panel.id === openId}
        aria-pressed={panel.id === openId}
        aria-label={panel.badge ? `${label} (${panel.badge} non lus)` : label}
        title={panel.id === openId ? platform.tip(`Masquer ${label}`, "toggle-web-panel") : label}
        data-panel-id={panel.id}
        onclick={() => panelsUi.toggle(panel.id)}
        oncontextmenu={(event) => (event.preventDefault(), api.panels.contextMenu(panel.id))}
      >
        <PanelIcon {panel} />
        {#if panel.badge}<span class="badge" aria-hidden="true">{panel.badge > 99 ? "99+" : panel.badge}</span>{/if}
      </button>
    {/each}
    <IconButton icon="plus" size="sm" label="Ajouter un panneau web" pressed={panelsUi.adding} onclick={() => panelsUi.startAdding()} />
  </div>
{/if}

<style>
  .strip {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) 0;
  }
  .strip.vertical {
    flex-direction: column;
    flex-wrap: nowrap;
  }
  .panel {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--hit-min);
    height: var(--hit-min);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
  }
  .panel:hover {
    background: var(--surface-hover);
  }
  .panel.open {
    background: color-mix(in oklab, var(--accent) 18%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent);
  }
  .panel:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .badge {
    position: absolute;
    top: 0;
    right: 0;
    min-width: 1.4em;
    padding: 0 var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--on-accent);
    font-size: var(--text-xs);
    font-weight: 700;
    line-height: 1.4;
    text-align: center;
    pointer-events: none;
  }
</style>
