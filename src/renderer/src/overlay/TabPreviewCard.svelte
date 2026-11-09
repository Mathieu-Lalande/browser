<script lang="ts">
  import { t } from "@shared/i18n";
  import { isThumbnailUrl, type TabPreview } from "@shared/tab-preview";
  import Favicon from "../components/Favicon.svelte";
  import Icon from "../components/Icon.svelte";

  /**
   * Tab hover preview card (ADR-038). The overlay view is exactly the card plus its shadow margin
   * (main sizes it), so the card fills the page; it only shows (no focus, no pointer input).
   */
  let { preview }: { preview: TabPreview } = $props();

  const thumbnail = $derived(isThumbnailUrl(preview.thumbnail) ? preview.thumbnail : null);
</script>

<div class="card" role="tooltip" data-testid="tab-preview">
  {#if thumbnail}
    <img class="thumbnail" src={thumbnail} alt="" />
  {/if}
  <div class="header">
    <Favicon src={preview.favicon} />
    <div class="info">
      <span class="title" data-testid="tab-preview-title">{preview.title}</span>
      {#if preview.host}<span class="host">{preview.host}</span>{/if}
    </div>
    <div class="badges">
      {#if preview.audible || preview.muted}
        <span class="badge" title={preview.muted ? t("tabPreviewCard.soundMuted") : t("tabPreviewCard.playingAudio")}>
          <Icon name={preview.muted ? "volume-off" : "volume"} size={12} />
        </span>
      {/if}
      {#if preview.asleep}
        <span class="badge sleep"><Icon name="moon" size={12} /> {t("tabPreviewCard.asleep")}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .card {
    position: fixed;
    /* The view's margin around the card holds its shadow (TAB_PREVIEW.margin). */
    inset: var(--space-3);
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow: var(--viewport-shadow);
    color: var(--text);
    pointer-events: none;
    animation: appear var(--motion-fast) var(--ease);
  }
  .thumbnail {
    display: block;
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    object-fit: cover;
    object-position: top;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .header {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .info {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: calc(var(--space-1) / 2);
    min-width: 0;
  }
  .title,
  .host {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .host {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .badges {
    display: flex;
    flex: none;
    gap: var(--space-1);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: calc(var(--space-1) / 2) var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--surface-active);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .badge.sleep {
    color: var(--accent-text);
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
  }
</style>
