<script lang="ts">
  import { COLOR_LABELS, HIGHLIGHT_COLORS, HIGHLIGHT_SWATCHES, type HighlightColor } from "@shared/annotations/model";
  import Icon from "../Icon.svelte";

  /**
   * The four highlight colors (ADR-037) as a row of swatches: a radio group when `value` is set
   * (the popover), plain buttons otherwise (the notes panel's "Surligner en …"), or toggles when
   * `selected` is given (filters of `browser://notes`).
   */
  let {
    value,
    selected,
    label,
    onpick,
  }: { value?: HighlightColor; selected?: readonly HighlightColor[]; label: string; onpick: (color: HighlightColor) => void } = $props();

  const role = $derived(value ? "radiogroup" : "group");
</script>

<div class="colors" {role} aria-label={label}>
  {#each HIGHLIGHT_COLORS as color (color)}
    {@const on = value === color || !!selected?.includes(color)}
    <button
      type="button"
      class="swatch"
      class:on
      style:--swatch={HIGHLIGHT_SWATCHES[color].ink}
      role={value ? "radio" : undefined}
      aria-checked={value ? on : undefined}
      aria-pressed={!value && selected ? on : undefined}
      aria-label={COLOR_LABELS[color]}
      title={COLOR_LABELS[color]}
      data-color={color}
      onclick={() => onpick(color)}
    >
      {#if on}<Icon name="check" size={12} strokeWidth={3} />{/if}
    </button>
  {/each}
</div>

<style>
  .colors {
    display: flex;
    gap: var(--space-2);
  }
  .swatch {
    display: grid;
    place-items: center;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
    color: rgb(0 0 0 / 0.75);
    transition: transform var(--motion-fast) var(--ease);
  }
  .swatch:hover {
    transform: scale(1.08);
  }
  .swatch.on {
    box-shadow:
      0 0 0 2px var(--bg-elevated),
      0 0 0 4px var(--accent);
  }
</style>
