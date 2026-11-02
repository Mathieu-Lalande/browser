<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  /**
   * The bordered box of the internal pages. "list": rows of a page (downloads, archive,
   * passwords, extensions, boosts), as a `ul` by default; "section": a settings section.
   */
  interface Props extends HTMLAttributes<HTMLElement> {
    as?: "ul" | "div" | "form";
    variant?: "list" | "section";
    children: Snippet;
  }

  let { as = "ul", variant = "list", class: className, children, ...rest }: Props = $props();
</script>

<svelte:element this={as} {...rest} class={["card", variant, className]}>{@render children()}</svelte:element>

<style>
  .card.list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 2px);
    background: var(--bg-elevated);
  }
  .card.section {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 4px);
    background: color-mix(in oklab, var(--bg) 45%, var(--bg-elevated));
  }
</style>
