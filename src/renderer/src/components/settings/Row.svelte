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
  /*
   * Label and control share the row while there is room; the control wraps below (right-aligned)
   * before the label gets narrower than ~160px, and on a narrow settings column (container query
   * on `.inner`, SettingsPage) everything stacks.
   */
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 24px;
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
    flex: 1 1 220px;
    flex-direction: column;
    gap: 2px;
    min-width: 160px;
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
    flex: 0 1 auto;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    max-width: 100%;
    margin-left: auto;
  }
  /* In a column, a 220px basis would be a height: the label keeps its own. */
  .stacked .text {
    flex-basis: auto;
  }
  .stacked .control {
    flex: auto;
    margin-left: 0;
  }
  @container settings (max-width: 520px) {
    .row {
      flex-direction: column;
      align-items: stretch;
    }
    .text {
      flex-basis: auto;
    }
    .control {
      justify-content: flex-start;
      margin-left: 0;
    }
  }
</style>
