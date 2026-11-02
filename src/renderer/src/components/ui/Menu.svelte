<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * A column of `MenuItem`s that the arrow keys walk (wrapping), like a native menu. Its box
   * (position, border, shadow) is the caller's, through `class`.
   */
  interface Props {
    label?: string;
    role?: "menu" | "group";
    class?: string;
    element?: HTMLElement;
    children: Snippet;
  }

  let { label, role = "menu", class: className, element = $bindable(), children }: Props = $props();

  function onkeydown(event: KeyboardEvent): void {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    const items = [...(element?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = index === -1 ? items.at(step === 1 ? 0 : -1) : items[(index + step + items.length) % items.length];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }
</script>

<div bind:this={element} class={["menu", className]} {role} aria-label={label} tabindex="-1" {onkeydown}>
  {@render children()}
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    outline: none;
  }
</style>
