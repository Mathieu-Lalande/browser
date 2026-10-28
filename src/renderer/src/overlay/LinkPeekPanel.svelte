<script lang="ts">
  import type { PeekAction, PeekState } from "@shared/peek";
  import { PEEK_HEADER_HEIGHT } from "@shared/peek";
  import { displayUrl } from "@shared/url";
  import { api } from "../lib/browser.svelte";
  import Icon from "../components/Icon.svelte";

  /**
   * Link peek card (ADR-027): main stacks the peeked page's native view inside it, below this
   * header; the overlay only draws the frame and names actions (main keeps the URL).
   */
  let { initial, onClose }: { initial: PeekState; onClose: (restoreFocus: boolean) => void } = $props();

  // svelte-ignore state_referenced_locally
  let peek = $state<PeekState>(initial);
  $effect(() => api.peek.onState((next) => (peek = next)));

  function act(action: PeekAction): void {
    api.peek.action(action);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    }
  }
</script>

<div
  class="card"
  role="dialog"
  aria-label="Aperçu du lien"
  tabindex="-1"
  style:left="{peek.card.x}px"
  style:top="{peek.card.y}px"
  style:width="{peek.card.width}px"
  style:height="{peek.card.height}px"
  onkeydown={onKeydown}
>
  <header style:height="{PEEK_HEADER_HEIGHT}px">
    <span class="badge" class:loading={peek.isLoading}><Icon name="link" size={14} /></span>
    <div class="info">
      <span class="title">{peek.title}</span>
      <span class="url">{displayUrl(peek.url)}</span>
    </div>
    <button class="action" title="Ouvrir dans un onglet" onclick={() => act("open-tab")}>
      <Icon name="open" size={14} /> <span>Ouvrir dans un onglet</span>
    </button>
    <button class="icon" title="Ouvrir en vue scindée" aria-label="Ouvrir en vue scindée" disabled={!peek.canSplit} onclick={() => act("open-split")}>
      <Icon name="split" size={15} />
    </button>
    <button class="icon" title="Fermer (Échap)" aria-label="Fermer" onclick={() => act("close")}>
      <Icon name="close" size={15} />
    </button>
  </header>
</div>

<style>
  .card {
    position: fixed;
    display: flex;
    flex-direction: column;
    border-radius: calc(var(--radius) + 6px);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 30px 80px -20px rgb(0 0 0 / 0.6),
      0 8px 24px -10px rgb(0 0 0 / 0.4);
    outline: none;
    animation: pop 0.16s var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 0 12px;
    min-width: 0;
  }
  .badge {
    display: grid;
    place-items: center;
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    background: var(--surface);
    color: var(--text-muted);
  }
  .badge.loading {
    color: var(--accent-text);
    animation: pulse 1s ease-in-out infinite alternate;
  }
  .info {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    line-height: 1.25;
  }
  .title,
  .url {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .title {
    font-size: 13px;
    font-weight: 600;
  }
  .url {
    font-size: 11.5px;
    color: var(--text-muted);
  }
  button {
    display: flex;
    align-items: center;
    flex: none;
    gap: 6px;
    height: 30px;
    border-radius: 8px;
    color: var(--text);
  }
  button:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  button:disabled {
    opacity: 0.4;
  }
  .action {
    padding: 0 10px;
    color: var(--accent-text);
    font-size: 12.5px;
    font-weight: 500;
  }
  .icon {
    justify-content: center;
    width: 30px;
  }
  @media (max-width: 560px) {
    .action span {
      display: none;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
  }
  @keyframes pulse {
    to {
      opacity: 0.45;
    }
  }
</style>
