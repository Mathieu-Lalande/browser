<script lang="ts">
  import { getCommand, type CommandId } from "@shared/commands";
  import { buildAppMenu, type MenuNode, type PageLink } from "@shared/menus";
  import type { Bounds } from "@shared/types";
  import { api, browser } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import { settings } from "../lib/settings.svelte";
  import { sync } from "../lib/sync.svelte";
  import Icon from "../components/Icon.svelte";
  import IconButton from "../components/ui/IconButton.svelte";
  import MenuList from "./MenuList.svelte";

  /**
   * The "…" app menu (ADR-033), hanging from its button at the start of the sidebar's nav row:
   * sync, windows, history and favorites, library pages, page tools, zoom, settings, more tools,
   * help, quit. Every entry is a registry command (src/shared/menus.ts) run by main.
   */
  let { anchor, onClose }: { anchor?: Bounds; onClose: (restoreFocus: boolean) => void } = $props();

  const WIDTH = 300;
  const MARGIN = 8;

  let innerWidth = $state(window.innerWidth);
  let innerHeight = $state(window.innerHeight);
  let history = $state<PageLink[]>([]);
  let bookmarks = $state<PageLink[]>([]);

  const tab = $derived(browser.activeTab);
  const isWeb = $derived(!!tab && /^(https?|file):/.test(tab.url) && !tab.interstitial);
  const defaultZoom = $derived(settings.current.appearance.pageZoom);

  $effect(() => {
    api.history.search("", 50).then(
      (entries) => (history = [...entries].sort((a, b) => b.lastVisit - a.lastVisit).map(({ url, title }) => ({ url, title }))),
      () => {},
    );
    api.bookmarks.list().then(
      (list) => (bookmarks = list.map(({ url, title }) => ({ url, title }))),
      () => {},
    );
  });

  const nodes = $derived(
    buildAppMenu({
      activeTab: tab,
      isPrivate: browser.isPrivate,
      history,
      bookmarks,
      favorites: (browser.state.favorites ?? []).map(({ url, title }) => ({ url, title })),
      recording: !!browser.state.recording,
    }),
  );

  const position = $derived.by(() => {
    const box = anchor ?? { x: MARGIN, y: MARGIN, width: 0, height: 0 };
    const top = Math.max(MARGIN, box.y + box.height + 6);
    const left = Math.max(MARGIN, Math.min(box.x, innerWidth - WIDTH - MARGIN));
    return { left, top, maxHeight: Math.max(240, innerHeight - top - MARGIN) };
  });

  /** Commands that show their own floating UI take the layer's place; the zoom row keeps the menu. */
  function runCommand(id: CommandId, stay = false): void {
    if (stay || getCommand(id).opensOverlay || id === "command-palette") {
      api.commands.run(id);
      return;
    }
    onClose(false);
    api.commands.run(id);
  }

  function run(node: MenuNode): void {
    if (node.kind === "command") runCommand(node.id);
    else if (node.kind === "link") {
      onClose(false);
      api.tabs.create(node.url);
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose(true);
  }

  const syncText = $derived.by(() => {
    const status = sync.status;
    if (browser.isPrivate) return "Rien n'est synchronisé en navigation privée";
    if (!status?.configured) return "Désactivée";
    switch (status.phase) {
      case "syncing":
        return "Synchronisation…";
      case "error":
        return "Erreur de synchronisation";
      case "offline":
        return "Hors ligne";
      default:
        return status.lastSync ? `À jour, ${new Date(status.lastSync).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Activée";
    }
  });
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="panel"
  data-testid="app-menu"
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:max-height="{position.maxHeight}px"
  style:width="{Math.min(WIDTH, innerWidth - 2 * MARGIN)}px"
  onkeydown={onKeydown}
>
  <MenuList {nodes} label="Menu de l'application" onRun={run} autofocus {special} />
</div>

{#snippet special(node: MenuNode)}
  {#if node.kind === "sync"}
    <div class="sync">
      <span class="sync-icon"><Icon name={sync.status?.phase === "error" ? "cloud-off" : "cloud"} size={16} /></span>
      <span class="sync-text">
        <span class="sync-title">Synchronisation</span>
        <span class="sync-state">{syncText}</span>
      </span>
      {#if !browser.isPrivate}
        {#if sync.status?.configured}
          <button class="pill" onclick={() => runCommand("sync-now", true)} disabled={sync.status.phase === "syncing"}>Synchroniser</button>
        {:else}
          <button class="pill" onclick={() => runCommand("open-sync")}>Se connecter</button>
        {/if}
      {/if}
    </div>
  {:else if node.kind === "zoom"}
    <div class="zoom" role="group" aria-label="Zoom">
      <Icon name="zoom-in" size={16} />
      <span class="label">Zoom</span>
      <button class="round" aria-label="Zoom arrière" title={platform.tip("Zoom arrière", "zoom-out")} disabled={!isWeb} onclick={() => runCommand("zoom-out", true)}>
        <Icon name="minimize" size={14} />
      </button>
      <button
        class="value"
        class:changed={!!tab && tab.zoom !== defaultZoom}
        aria-label="Zoom {tab?.zoom ?? defaultZoom} %, revenir à {defaultZoom} %"
        title={platform.tip(`Revenir à ${defaultZoom} %`, "zoom-reset")}
        data-testid="app-menu-zoom"
        disabled={!isWeb}
        onclick={() => runCommand("zoom-reset", true)}
      >
        {isWeb ? tab!.zoom : defaultZoom}&#8239;%
      </button>
      <button class="round" aria-label="Zoom avant" title={platform.tip("Zoom avant", "zoom-in")} disabled={!isWeb} onclick={() => runCommand("zoom-in", true)}>
        <Icon name="plus" size={14} />
      </button>
      <IconButton size="sm" icon="maximize" label="Plein écran" command="toggle-fullscreen" onclick={() => runCommand("toggle-fullscreen", true)} />
    </div>
  {/if}
{/snippet}

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
    animation: pop var(--motion-base, 0.16s) var(--ease);
    transform-origin: top left;
  }
  .sync {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 10px;
  }
  .sync-icon {
    display: grid;
    color: var(--accent-text);
  }
  .sync-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .sync-title {
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
  }
  .sync-state {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 11px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .pill {
    height: 26px;
    padding: 0 10px;
    border-radius: 13px;
    background: var(--surface);
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
  }
  .pill:hover,
  .round:hover,
  .value:hover {
    background: var(--surface-active);
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 4px 0 10px;
    color: var(--text);
    font-size: 13px;
  }
  .label {
    flex: 1;
    min-width: 0;
  }
  .round {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 13px;
    background: var(--surface);
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
  button:disabled {
    opacity: 0.45;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.97) translateY(-4px);
    }
  }
</style>
