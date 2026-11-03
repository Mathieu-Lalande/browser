<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon, { type IconName } from "../Icon.svelte";

  /**
   * One row of a `Menu`: icon, label, then its shortcut (`keys`) or, with `expanded`, a chevron
   * for the part it unfolds below. `color`: the icon sits in a disc of that color (a profile).
   */
  interface Props extends HTMLButtonAttributes {
    icon: IconName;
    iconSize?: number;
    label: string;
    keys?: string;
    expanded?: boolean;
    color?: string;
    children?: Snippet;
  }

  let { icon, iconSize = 16, label, keys, expanded, color, children, ...rest }: Props = $props();
</script>

<button class="item" aria-expanded={expanded} {...rest}>
  {#if color}
    <span class="disc" style:background={color}><Icon name={icon} size={iconSize - 2} /></span>
  {:else}
    <Icon name={icon} size={iconSize} />
  {/if}
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
  .disc {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--space-5);
    height: var(--space-5);
    margin: calc(-1 * var(--space-1));
    border-radius: var(--radius-pill);
    color: #fff;
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
