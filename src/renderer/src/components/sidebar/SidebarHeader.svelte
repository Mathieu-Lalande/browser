<script lang="ts">
  import { browser } from "../../lib/browser.svelte";
  import { platform } from "../../lib/platform.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import WindowControls from "../WindowControls.svelte";

  /**
   * The sidebar's title bar (a window drag area): private badge, zen and hide buttons.
   * `windowControls`: draw the window buttons here (Windows/Linux, see App): at its start with the
   * sidebar on the left, at its end (the window's right edge) with it on the right.
   */
  let { onToggle, windowControls = false }: { onToggle: () => void; windowControls?: boolean } = $props();

  const controlsAtEnd = $derived(settings.current.layout.sidebarPosition === "right");
  // macOS traffic lights sit at the window's top-left: only a left sidebar makes room for them.
  const roomForTrafficLights = $derived(platform.isMac && settings.current.layout.sidebarPosition === "left");
  const zen = $derived(settings.current.layout.zenMode);
</script>

<header class="titlebar drag" class:mac={roomForTrafficLights}>
  {#if windowControls && !controlsAtEnd}<WindowControls />{/if}
  <!-- The flexible part: it gives way (the badge folds to its icon), never the buttons. -->
  <div class="title-slot">
    {#if browser.isPrivate}
      <div class="private-badge" title="Navigation privée : ni historique, ni cookies conservés après la fermeture de la fenêtre">
        <Icon name="mask" size={16} />
        <span class="private-label">Navigation privée</span>
      </div>
    {/if}
  </div>
  <IconButton class="no-drag" icon="zen" label="Mode zen" command="toggle-zen" pressed={zen} onclick={() => settings.update({ layout: { zenMode: !zen } })} />
  <IconButton class="no-drag" icon="sidebar" label="Masquer la barre latérale" command="toggle-sidebar" onclick={onToggle} />
  {#if windowControls && controlsAtEnd}<WindowControls />{/if}
</header>

<style>
  .titlebar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    min-width: 0;
    height: 40px;
    margin-right: -4px;
  }
  .titlebar > :global(*) {
    flex: none;
  }
  .titlebar > .title-slot {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    height: 100%;
    overflow: hidden;
    container-type: inline-size;
  }
  .titlebar.mac {
    padding-left: 72px;
  }
  .private-badge {
    display: flex;
    flex: none;
    align-items: center;
    gap: 7px;
    margin-left: 6px;
    padding: 4px 10px 4px 8px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--accent) 22%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent);
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  /* Not enough room for the label: the icon alone (the tooltip and the accessible name stay). */
  @container (max-width: 180px) {
    .private-badge {
      margin-left: 2px;
      padding: 4px 5px;
    }
    .private-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
</style>
