<script lang="ts">
  import type { CommandId } from "@shared/commands";
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { platform } from "../../lib/platform.svelte";
  import Icon, { type IconName } from "../Icon.svelte";

  /**
   * A square button holding one icon: the chrome's toolbar buttons. `label` is its accessible
   * name; its tooltip is `title` (default: the label), with the shortcut of `command` if given.
   * `size`: "md" (toolbar, --icon-button), "sm" (26px, in rows), "row" (28px, list actions).
   * `as="span"` draws the same box, inert (the space swipe's preview of a neighbour space).
   */
  interface Props extends Omit<HTMLButtonAttributes, "title"> {
    icon?: IconName;
    iconSize?: number;
    label: string;
    title?: string;
    command?: CommandId;
    /** Toggle state: `aria-pressed`, drawn in the accent color. */
    pressed?: boolean;
    /** Accent color without `aria-pressed` (a state shown, not a toggle). */
    on?: boolean;
    /** Drawn as hovered (its menu is open). */
    active?: boolean;
    size?: "md" | "sm" | "row";
    as?: "button" | "span";
    element?: HTMLElement;
    children?: Snippet;
  }

  let {
    icon,
    iconSize,
    label,
    title,
    command,
    pressed,
    on = false,
    active = false,
    size = "md",
    as = "button",
    element = $bindable(),
    children,
    class: className,
    ...rest
  }: Props = $props();

  const tooltip = $derived(command ? platform.tip(title ?? label, command) : (title ?? label));
</script>

{#snippet content()}
  {#if children}{@render children()}{:else if icon}<Icon name={icon} size={iconSize} />{/if}
{/snippet}

{#if as === "span"}
  <span bind:this={element} class={["icon-button", `size-${size}`, className, { on: on || pressed }]} aria-hidden="true">{@render content()}</span>
{:else}
  <button
    bind:this={element}
    {...rest}
    class={["icon-button", `size-${size}`, className, { on: on || pressed, active }]}
    aria-label={label}
    aria-pressed={pressed}
    title={tooltip}
  >
    {@render content()}
  </button>
{/if}

<style>
  .icon-button {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--icon-button);
    height: var(--icon-button);
    border-radius: 8px;
    color: var(--text-muted);
  }
  .icon-button.size-sm {
    width: 26px;
    height: 26px;
  }
  .icon-button.size-row {
    width: 28px;
    height: 28px;
    border-radius: 7px;
  }
  .icon-button.on {
    color: var(--accent-text);
  }
  button.icon-button:hover:not(:disabled),
  .icon-button.active {
    background: var(--surface-hover);
    color: var(--text);
  }
  .icon-button:disabled {
    opacity: 0.35;
  }
</style>
