<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon, { type IconName } from "../Icon.svelte";

  /** What a list shows when it has nothing to show: icon, title, a hint, and an optional action. */
  let {
    icon,
    title,
    hint,
    compact = false,
    action,
  }: { icon: IconName; title: string; hint?: string; compact?: boolean; action?: Snippet } = $props();
</script>

<div class="empty" class:compact role="status">
  <span class="glyph"><Icon name={icon} size={compact ? 18 : 22} /></span>
  <p class="title">{title}</p>
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-6) var(--space-4);
    text-align: center;
  }
  .empty.compact {
    padding: var(--space-4) var(--space-3);
  }
  .glyph {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-bottom: var(--space-2);
    border-radius: var(--radius-lg);
    background: color-mix(in oklab, var(--accent) 12%, transparent);
    color: var(--accent-text);
  }
  .compact .glyph {
    width: 36px;
    height: 36px;
    margin-bottom: var(--space-1);
  }
  p {
    max-width: 44ch;
    margin: 0;
  }
  .title {
    color: var(--text);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .compact .title {
    font-size: var(--text-sm);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .action {
    margin-top: var(--space-3);
  }
</style>
