<script lang="ts">
  import { t } from "@shared/i18n";
  import type { PeekAction, PeekState } from "@shared/peek";
  import { PEEK_HEADER_HEIGHT, PEEK_SUMMARY_HEIGHT } from "@shared/peek";
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
  aria-label={t("linkPeekPanel.linkPreview")}
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
    {#if peek.summary.status !== "off"}
      <!-- AI summary (ADR-059): only with the assistant set up, never in a private window. -->
      <button
        class="action summarize"
        title={t("linkPeekPanel.summarize")}
        aria-pressed={peek.summary.status === "done"}
        disabled={peek.summary.status === "loading" || peek.isLoading}
        onclick={() => act("summarize")}
      >
        <Icon name="sparkles" size={14} /> <span>{t("linkPeekPanel.summarize")}</span>
      </button>
    {/if}
    <button class="action" title={t("linkPeekPanel.openTab")} onclick={() => act("open-tab")}>
      <Icon name="open" size={14} /> <span>{t("linkPeekPanel.openTab")}</span>
    </button>
    <button class="icon" title={t("linkPeekPanel.openSplitView")} aria-label={t("linkPeekPanel.openSplitView")} disabled={!peek.canSplit} onclick={() => act("open-split")}>
      <Icon name="split" size={15} />
    </button>
    <button class="icon" title={t("linkPeekPanel.closeEsc")} aria-label={t("linkPeekPanel.close")} onclick={() => act("close")}>
      <Icon name="close" size={15} />
    </button>
  </header>
  {#if peek.summary.status === "loading" || peek.summary.status === "done" || peek.summary.status === "error"}
    <section class="summary" style:height="{PEEK_SUMMARY_HEIGHT}px" aria-live="polite" data-testid="peek-summary">
      {#if peek.summary.status === "loading"}
        <p class="muted"><Icon name="sparkles" size={13} /> {t("linkPeekPanel.summarizing")}</p>
      {:else if peek.summary.status === "error"}
        <p class="muted">{peek.summary.message || t("linkPeekPanel.summaryFailed")}</p>
      {:else}
        <ul>
          {#each peek.summary.bullets as bullet, index (index)}<li>{bullet}</li>{/each}
        </ul>
      {/if}
    </section>
  {/if}
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
    animation: pop var(--motion-base) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2) 0 var(--space-3);
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
  .summary {
    flex: none;
    margin: 0 var(--space-2) var(--space-1);
    padding: var(--space-2) var(--space-3);
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .summary ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding-left: var(--space-4);
  }
  .summary li::marker {
    color: var(--accent-text);
  }
  .muted {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--text-muted);
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
