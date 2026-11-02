<script lang="ts">
  import type { CommandId, CommandIcon } from "@shared/commands";
  import type { Bounds, TabId } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import { settings } from "../lib/settings.svelte";
  import Icon from "../components/Icon.svelte";
  import Menu from "../components/ui/Menu.svelte";
  import MenuItem from "../components/ui/MenuItem.svelte";
  import QrCode from "../components/settings/QrCode.svelte";

  /**
   * Page options popover (ADR-031), hanging below the address bar: copy the link, zoom, screenshots,
   * recording, reader and mobile versions, the site's boost and info, a QR code of the page. Every
   * action is a registry command run by main on the active tab (src/shared/commands.ts).
   */
  let { anchor, tabId, onClose }: { anchor?: Bounds; tabId: TabId; onClose: (restoreFocus: boolean) => void } = $props();

  const WIDTH = 288;
  const MARGIN = 8;

  let panel = $state<HTMLElement>();
  let innerWidth = $state(window.innerWidth);
  let innerHeight = $state(window.innerHeight);
  let captureOpen = $state(false);
  let qrOpen = $state(false);
  let copied = $state(false);

  const tab = $derived(browser.state.tabs.find((item) => item.id === tabId));
  const isWeb = $derived(!!tab && /^(https?|file):/.test(tab.url) && !tab.interstitial);
  const recording = $derived(!!browser.state.recording);
  const defaultZoom = $derived(settings.current.appearance.pageZoom);

  const position = $derived.by(() => {
    const box = anchor ?? { x: MARGIN, y: MARGIN, width: 0, height: 0 };
    const top = Math.max(MARGIN, box.y + box.height + 6);
    const left = Math.max(MARGIN, Math.min(box.x, innerWidth - WIDTH - MARGIN));
    return { left, top, maxHeight: Math.max(200, innerHeight - top - MARGIN) };
  });

  $effect(() => panel?.focus());

  // The tab went away (closed, navigated to the start page): nothing left to act on.
  $effect(() => {
    if (!tab?.url) onClose(false);
  });

  /** Runs a command; `stay` keeps the popover (zoom), `handoff` lets main replace or close the layer. */
  function run(id: CommandId, mode: "close" | "stay" | "handoff" = "close"): void {
    api.commands.run(id);
    if (mode === "close") onClose(false);
  }

  function copyLink(): void {
    api.commands.run("copy-url");
    copied = true;
    setTimeout(() => onClose(false), 500);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose(true);
  }

  type Item = { id: CommandId; icon: CommandIcon; label: string; mode?: "close" | "stay" | "handoff"; hidden?: boolean };
  const captures: Item[] = [
    { id: "screenshot-visible", icon: "camera", label: "Zone visible", mode: "handoff" },
    { id: "screenshot-full", icon: "capture-full", label: "Page entière", mode: "handoff" },
    { id: "screenshot-element", icon: "capture-element", label: "Élément…", mode: "handoff" },
  ];
  const items = $derived<Item[]>([
    { id: "record-video", icon: "video", label: recording ? "Arrêter l'enregistrement" : "Enregistrer une vidéo", mode: "handoff", hidden: !isWeb },
    {
      id: "toggle-reader",
      icon: "reader",
      label: tab?.reader ? "Quitter le mode lecture" : "Mode lecture",
      hidden: !isWeb || !(tab?.readerable || tab?.reader),
    },
    { id: "toggle-mobile-site", icon: "smartphone", label: tab?.mobileSite ? "Version pour ordinateur" : "Version mobile", hidden: !isWeb },
    { id: "open-boosts", icon: "rocket", label: "Boost du site", hidden: !isWeb || browser.isPrivate },
    { id: "site-info", icon: "info", label: "Infos sur le site", mode: "handoff", hidden: !tab || !/^https?:/.test(tab.url) },
  ]);
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={panel}
  class="panel"
  role="dialog"
  aria-label="Options de la page"
  tabindex="-1"
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:max-height="{position.maxHeight}px"
  style:width="{Math.min(WIDTH, innerWidth - 2 * MARGIN)}px"
  onkeydown={onKeydown}
>
  {#if tab}
    <header>
      <span class="host" title={tab.url}>{displayUrl(tab.url)}</span>
    </header>
    <!-- Arrow keys walk the actions, like a menu. -->
    <Menu class="body" role="group">
      <MenuItem icon={copied ? "check" : "copy"} label={copied ? "Lien copié" : "Copier le lien"} keys={platform.shortcut("copy-url")} onclick={copyLink} />

      {#if isWeb}
        <div class="zoom" role="group" aria-label="Zoom">
          <Icon name="zoom-in" size={16} />
          <span class="label">Zoom</span>
          <button class="round" aria-label="Zoom arrière" title={platform.tip("Zoom arrière", "zoom-out")} onclick={() => run("zoom-out", "stay")}>
            <Icon name="minimize" size={14} />
          </button>
          <button
            class="value"
            class:changed={tab.zoom !== defaultZoom}
            aria-label="Zoom {tab.zoom} %, revenir à {defaultZoom} %"
            title={platform.tip(`Revenir à ${defaultZoom} %`, "zoom-reset")}
            data-testid="page-zoom"
            onclick={() => run("zoom-reset", "stay")}
          >
            {tab.zoom}&#8239;%
          </button>
          <button class="round" aria-label="Zoom avant" title={platform.tip("Zoom avant", "zoom-in")} onclick={() => run("zoom-in", "stay")}>
            <Icon name="plus" size={14} />
          </button>
        </div>

        <MenuItem icon="camera" label="Capture d'écran" expanded={captureOpen} onclick={() => (captureOpen = !captureOpen)} />
        {#if captureOpen}
          <div class="sub" role="group" aria-label="Capture d'écran">
            {#each captures as item (item.id)}
              <MenuItem icon={item.icon} iconSize={15} label={item.label} keys={platform.shortcut(item.id)} onclick={() => run(item.id, item.mode)} />
            {/each}
          </div>
        {/if}
      {/if}

      {#each items.filter((item) => !item.hidden) as item (item.id)}
        <MenuItem icon={item.icon} label={item.label} keys={platform.shortcut(item.id)} onclick={() => run(item.id, item.mode)} />
      {/each}

      <MenuItem icon="qr" label="Partager (code QR)" expanded={qrOpen} onclick={() => (qrOpen = !qrOpen)} />
      {#if qrOpen}
        <div class="qr">
          <QrCode value={tab.url} size={168} label="Code QR de {displayUrl(tab.url)}" />
          <p>Scannez-le avec un téléphone pour ouvrir cette page.</p>
        </div>
      {/if}
    </Menu>
  {/if}
</div>

<style>
  .panel {
    position: fixed;
    display: flex;
    flex-direction: column;
    overflow: auto;
    border-radius: calc(var(--radius) + 4px);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55),
      0 4px 14px -6px rgb(0 0 0 / 0.35);
    outline: none;
    animation: pop 0.16s var(--ease);
    transform-origin: top left;
  }
  header {
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--border);
  }
  .host {
    display: block;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .panel :global(.body) {
    padding: 4px;
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 7px;
    color: var(--text);
    font-size: 13px;
    text-align: left;
  }
  .label {
    flex: 1;
    min-width: 0;
  }
  .sub {
    display: flex;
    flex-direction: column;
    margin-left: 16px;
  }
  .round {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 13px;
    background: var(--surface);
  }
  .round:hover,
  .value:hover {
    background: var(--surface-active);
  }
  .value {
    min-width: 54px;
    height: 26px;
    padding: 0 6px;
    border-radius: 13px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .value.changed {
    color: var(--accent-text);
  }
  .qr {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 10px;
  }
  .qr p {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.97) translateY(-4px);
    }
  }
</style>
