<script lang="ts">
  import type { Snippet } from "svelte";
  import { getRowFilter } from "./filter";

  /**
   * One setting: label and hint on the left, its control on the right. `stacked`: a wide control
   * (gallery, list, field with buttons) takes the full width under the label instead.
   * `keywords`: extra words the settings search finds it by. Hidden when a search does not match.
   * `anchor`: its name in deep links (`browser://settings#section/anchor`, ADR-032).
   */
  let {
    label,
    hint,
    id,
    anchor,
    stacked = false,
    keywords = "",
    children,
  }: { label: string; hint?: string; id?: string; anchor?: string; stacked?: boolean; keywords?: string; children: Snippet } = $props();

  const filter = getRowFilter();
  const hidden = $derived(!!filter?.active && !filter.matches(`${label} ${hint ?? ""} ${keywords}`));
</script>

<div class="row" class:stacked data-row data-setting={anchor} data-hidden={hidden || undefined}>
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
   * on `.inner`, SettingsPage) everything stacks. A stacked control is a block of the full width:
   * its content (a grid, a field) stretches instead of shrinking to its narrowest size.
   */
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-5);
    min-height: 56px;
    padding: var(--space-3) var(--space-4);
  }
  .row[data-hidden] {
    display: none;
  }
  /* A divider above every row that follows a visible one (rows hidden by a search excepted). */
  .row:not([data-hidden]) ~ :global([data-setting]) {
    border-top: 1px solid var(--border);
  }
  .row.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
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
    font-size: var(--text-xs);
    line-height: 1.45;
  }
  .control {
    display: flex;
    flex: 0 1 auto;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    max-width: 100%;
    margin-left: auto;
  }
  /* In a column, a 220px basis would be a height: the label keeps its own. */
  .stacked .text {
    flex-basis: auto;
  }
  .stacked .control {
    display: block;
    flex: none;
    width: 100%;
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
