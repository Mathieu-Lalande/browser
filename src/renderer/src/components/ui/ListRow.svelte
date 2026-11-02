<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLLiAttributes } from "svelte/elements";

  /**
   * One row of a list `Card` (passwords, archive, extensions, boosts): content in a line,
   * highlighted on hover. `align="start"` tops the items (multi-line rows), `dense` is shorter.
   * It keeps the `row` class (pages and tests find their rows by it).
   */
  interface Props extends HTMLLiAttributes {
    align?: "center" | "start";
    dense?: boolean;
    disabled?: boolean;
    children: Snippet;
  }

  let { align = "center", dense = false, disabled = false, class: className, children, ...rest }: Props = $props();
</script>

<li {...rest} class={["row", "list-row", className, { start: align === "start", dense, disabled }]}>{@render children()}</li>

<style>
  .list-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    border-radius: var(--radius);
  }
  .list-row.start {
    align-items: flex-start;
  }
  .list-row.dense {
    padding: 8px 10px;
  }
  .list-row:hover {
    background: var(--surface-hover);
  }
</style>
