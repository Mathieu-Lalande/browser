<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon, { type IconName } from "../Icon.svelte";

  /**
   * The text button of pages, panels and dialogs. `variant`: "primary" (the one main action, accent
   * fill), "secondary" (bordered, the default), "ghost" (no box until hovered, links), "quiet"
   * (muted text, no box until hovered: secondary actions in lists and panels), "danger"
   * (destructive, red text). `size`: "md" (32px, --field-height) or "sm" (28px).
   * An optional leading `icon` is drawn at --icon-inline.
   */
  interface Props extends HTMLButtonAttributes {
    variant?: "primary" | "secondary" | "ghost" | "quiet" | "danger";
    size?: "md" | "sm";
    icon?: IconName;
    element?: HTMLButtonElement;
    children?: Snippet;
  }

  let {
    variant = "secondary",
    size = "md",
    icon,
    type = "button",
    element = $bindable(),
    class: className,
    children,
    ...rest
  }: Props = $props();
</script>

<button bind:this={element} {type} {...rest} class={["button", variant, size, className]}>
  {#if icon}<Icon name={icon} size={14} />{/if}
  {@render children?.()}
</button>

<style>
  .button {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--field-height);
    padding: 0 var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    transition:
      background var(--motion-fast) var(--ease),
      border-color var(--motion-fast) var(--ease),
      color var(--motion-fast) var(--ease),
      transform var(--motion-fast) var(--ease);
  }
  .button.sm {
    height: var(--hit-min);
    padding: 0 10px;
    font-size: var(--text-xs);
  }
  .button:active:not(:disabled) {
    transform: scale(0.97);
  }
  .button:disabled {
    opacity: 0.45;
  }
  .secondary {
    border-color: var(--border);
    background: var(--surface);
    color: var(--text);
  }
  .secondary:hover:not(:disabled),
  .secondary[aria-pressed="true"] {
    background: var(--surface-hover);
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .primary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--accent), var(--on-accent) 12%);
  }
  .ghost {
    color: var(--accent-text);
  }
  .ghost:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .quiet {
    color: var(--text-muted);
  }
  .quiet:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }
  .danger {
    border-color: color-mix(in oklab, var(--danger) 35%, transparent);
    background: color-mix(in oklab, var(--danger) 8%, transparent);
    color: var(--danger-text);
  }
  .danger:hover:not(:disabled) {
    background: color-mix(in oklab, var(--danger) 16%, transparent);
  }
</style>
