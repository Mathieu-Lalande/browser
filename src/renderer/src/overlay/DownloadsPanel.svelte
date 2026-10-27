<script lang="ts">
  import type { Bounds } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import { downloads } from "../lib/downloads.svelte";
  import DownloadRow from "../components/downloads/DownloadRow.svelte";
  import Icon from "../components/Icon.svelte";

  /** Downloads popover, floating above the page next to the sidebar button it hangs from. */
  let { anchor, onClose }: { anchor?: Bounds; onClose: (restoreFocus: boolean) => void } = $props();

  const WIDTH = 380;
  const MARGIN = 8;
  const RECENT = 8;

  let panel = $state<HTMLElement>();
  // The overlay view may get its size just after the request arrives: follow it.
  let innerWidth = $state(window.innerWidth);
  let innerHeight = $state(window.innerHeight);
  const recent = $derived(downloads.entries.slice(0, RECENT));
  const more = $derived(downloads.entries.length - recent.length);

  /** Above the button, aligned on its side of the window (the sidebar may be on the right). */
  const position = $derived.by(() => {
    const box = anchor ?? { x: MARGIN, y: innerHeight - MARGIN, width: 0, height: 0 };
    const onLeft = box.x + box.width / 2 < innerWidth / 2;
    const left = onLeft
      ? Math.max(MARGIN, Math.min(box.x - 4, innerWidth - WIDTH - MARGIN))
      : Math.max(MARGIN, box.x + box.width + 4 - WIDTH);
    return { left, bottom: Math.max(MARGIN, innerHeight - box.y + 6), maxHeight: Math.max(160, box.y - 6 - MARGIN * 2) };
  });

  $effect(() => panel?.focus());

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    }
  }

  function showAll(): void {
    api.downloads.openPage();
    onClose(false);
  }
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div
  bind:this={panel}
  class="panel"
  role="dialog"
  aria-label="Téléchargements"
  tabindex="-1"
  style:left="{position.left}px"
  style:bottom="{position.bottom}px"
  style:max-height="{position.maxHeight}px"
  style:width="{WIDTH}px"
  onkeydown={onKeydown}
>
  <header>
    <h2>Téléchargements</h2>
    <button class="all" onclick={showAll}>Tout afficher <Icon name="arrow" size={12} /></button>
  </header>

  {#if recent.length}
    <div class="list">
      {#each recent as entry (entry.id)}
        <DownloadRow {entry} />
      {/each}
    </div>
    {#if more > 0}
      <button class="more" onclick={showAll}>{more} autre{more > 1 ? "s" : ""} téléchargement{more > 1 ? "s" : ""}…</button>
    {/if}
  {:else}
    <div class="empty">
      <span class="badge"><Icon name="download" size={20} /></span>
      <p>Aucun téléchargement pour l'instant.</p>
      <p class="hint">Les fichiers vont dans votre dossier Téléchargements, sans boîte de dialogue.</p>
    </div>
  {/if}
</div>

<style>
  .panel {
    position: fixed;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: calc(var(--radius) + 4px);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55),
      0 4px 14px -6px rgb(0 0 0 / 0.35);
    outline: none;
    animation: pop 0.16s var(--ease);
    transform-origin: bottom left;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 10px 8px 16px;
  }
  h2 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .all {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    border-radius: 7px;
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 500;
  }
  .all:hover {
    background: var(--surface-hover);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-height: 0;
    padding: 0 6px 6px;
    overflow-y: auto;
  }
  .more {
    margin: 0 6px 6px;
    height: 30px;
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .more:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 14px 24px 22px;
    text-align: center;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-bottom: 6px;
    border-radius: 12px;
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: var(--accent-text);
  }
  p {
    margin: 0;
  }
  .hint {
    color: var(--text-muted);
    font-size: 12px;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }
</style>
