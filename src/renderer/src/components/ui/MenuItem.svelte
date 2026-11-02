<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon, { type IconName } from "../Icon.svelte";

  /**
   * One row of a `Menu`: icon, label, then its shortcut (`keys`) or, with `expanded`, a chevron
   * for the part it unfolds below.
   */
  interface Props extends HTMLButtonAttributes {
    icon: IconName;
    iconSize?: number;
    label: string;
    keys?: string;
    expanded?: boolean;
    children?: Snippet;
  }

  let { icon, iconSize = 16, label, keys, expanded, children, ...rest }: Props = $props();
</script>

<button class="item" aria-expanded={expanded} {...rest}>
  <Icon name={icon} size={iconSize} />
  <span class="label">{label}</span>
  {#if expanded !== undefined}
    <span class="chevron" class:open={expanded}><Icon name="chevron-right" size={14} /></span>
  {:else if keys}
    <span class="keys">{keys}</span>
  {/if}
  {@render children?.()}
</button>

<style>
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 32px;
    padding: 0 10px;
    border: none;
    border-radius: calc(var(--radius) - 3px);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }
  .item:hover,
  .item:focus-visible {
    background: var(--surface-hover);
    outline: none;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .keys {
    color: var(--text-faint);
    font-size: 11px;
  }
  .chevron {
    display: grid;
    color: var(--text-faint);
    transition: transform 0.15s var(--ease);
  }
  .chevron.open {
    transform: rotate(90deg);
  }
</style>
