<script lang="ts">
  import type { Snippet } from "svelte";

  /** One setting: label and hint on the left, its control on the right (or below with `stacked`). */
  let {
    label,
    hint,
    id,
    stacked = false,
    children,
  }: { label: string; hint?: string; id?: string; stacked?: boolean; children: Snippet } = $props();
</script>

<div class="row" class:stacked>
  <div class="text">
    {#if id}<label class="label" for={id}>{label}</label>{:else}<span class="label">{label}</span>{/if}
    {#if hint}<span class="hint">{hint}</span>{/if}
  </div>
  <div class="control">
    {@render children()}
  </div>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 24px;
    min-height: 58px;
    padding: 12px 18px;
  }
  .row + :global(.row) {
    border-top: 1px solid var(--border);
  }
  .row.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .label {
    color: var(--text);
    font-weight: 500;
  }
  .hint {
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.45;
  }
  .control {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
  }
  .stacked .control {
    flex: auto;
  }
</style>
