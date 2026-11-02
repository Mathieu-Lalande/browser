<script lang="ts">
  import type { CommandId, CommandIcon } from "@shared/commands";
  import type { Bounds, TabId } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import { settings } from "../lib/settings.svelte";
  import Icon from "../components/Icon.svelte";
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
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // Arrow keys walk the actions, like a menu.
      const items = [...(panel?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = index === -1 ? items.at(step === 1 ? 0 : -1) : items[(index + step + items.length) % items.length];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    }
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
    <div class="body">
      <button class="item" onclick={copyLink}>
        <Icon name={copied ? "check" : "copy"} size={16} />
        <span class="label">{copied ? "Lien copié" : "Copier le lien"}</span>
        <span class="keys">{platform.shortcut("copy-url")}</span>
      </button>

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

        <button class="item" aria-expanded={captureOpen} onclick={() => (captureOpen = !captureOpen)}>
          <Icon name="camera" size={16} />
          <span class="label">Capture d'écran</span>
          <span class="chevron" class:open={captureOpen}><Icon name="chevron-right" size={14} /></span>
        </button>
        {#if captureOpen}
          <div class="sub" role="group" aria-label="Capture d'écran">
            {#each captures as item (item.id)}
              <button class="item" onclick={() => run(item.id, item.mode)}>
                <Icon name={item.icon} size={15} />
                <span class="label">{item.label}</span>
                <span class="keys">{platform.shortcut(item.id)}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/if}

      {#each items.filter((item) => !item.hidden) as item (item.id)}
        <button class="item" onclick={() => run(item.id, item.mode)}>
          <Icon name={item.icon} size={16} />
          <span class="label">{item.label}</span>
          <span class="keys">{platform.shortcut(item.id)}</span>
        </button>
      {/each}

      <button class="item" aria-expanded={qrOpen} onclick={() => (qrOpen = !qrOpen)}>
        <Icon name="qr" size={16} />
        <span class="label">Partager (code QR)</span>
        <span class="chevron" class:open={qrOpen}><Icon name="chevron-right" size={14} /></span>
      </button>
      {#if qrOpen}
        <div class="qr">
          <QrCode value={tab.url} size={168} label="Code QR de {displayUrl(tab.url)}" />
          <p>Scannez-le avec un téléphone pour ouvrir cette page.</p>
        </div>
      {/if}
    </div>
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
  .body {
    display: flex;
    flex-direction: column;
    padding: 4px;
  }
  .item,
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
  .item:hover,
  .item:focus-visible {
    background: var(--surface-hover);
    outline: none;
  }
  .label {
    flex: 1;
    min-width: 0;
  }
  .keys {
    color: var(--text-faint);
    font-size: 11px;
  }
  .chevron {
    display: grid;
    color: var(--text-faint);
    transition: transform 0.15s var(--ease);
  }
  .chevron.open {
    transform: rotate(90deg);
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
