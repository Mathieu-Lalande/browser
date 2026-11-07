<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  /**
   * A row of the tab tree, indented to its `depth` (`--indent` per level, set by the sidebar).
   * Other attributes (the drag and drop `data-*`, handlers) go to the row element.
   */
  interface Props extends HTMLAttributes<HTMLDivElement> {
    depth: number;
    folder?: boolean;
    selected?: boolean;
    dragged?: boolean;
    /** Highlighted as the drop target (a tab dropped into this folder). */
    dropInside?: boolean;
    /** A dragged tab would be shown beside this one (split view). */
    dropSplit?: boolean;
    children: Snippet;
  }
  let { depth, folder = false, selected = false, dragged = false, dropInside = false, dropSplit = false, children, ...rest }: Props = $props();
</script>

<div class={["row", { "folder-row": folder, selected, dragged, "drop-inside": dropInside, "drop-split": dropSplit }]} style:--depth={depth} {...rest}>
  {@render children()}
</div>

<style>
  /* Indentation narrows with the sidebar: four levels deep must not crush the titles. */
  .row {
    flex: none;
    min-width: 0;
    padding-left: calc(var(--depth, 0) * var(--indent));
  }
  .row.selected {
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .row.dragged {
    opacity: 0.4;
  }
  .folder-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--radius);
  }
  .folder-row:hover {
    background: var(--surface-hover);
  }
  .folder-row.drop-inside {
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent-text) 55%, transparent);
  }
  .row.drop-split {
    border-radius: var(--radius);
    box-shadow: inset 0 0 0 2px var(--accent-text);
  }
  .folder-row :global(.more) {
    opacity: 0;
  }
  .folder-row:hover :global(.more),
  .folder-row :global(.more:focus-visible) {
    opacity: 1;
  }
</style>
