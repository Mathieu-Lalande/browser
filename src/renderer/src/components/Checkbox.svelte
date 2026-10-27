<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  /** The app's checkbox (themed, Lucide check), in place of the native one. The label is the content. */
  let { checked, onchange, children }: { checked: boolean; onchange: (checked: boolean) => void; children: Snippet } = $props();
</script>

<button class="checkbox" role="checkbox" aria-checked={checked} onclick={() => onchange(!checked)}>
  <span class="box" aria-hidden="true">{#if checked}<Icon name="check" size={12} strokeWidth={3} />{/if}</span>
  <span class="label">{@render children()}</span>
</button>

<style>
  .checkbox {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 0;
    color: inherit;
    text-align: left;
  }
  .box {
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-top: 1px;
    border-radius: 5px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1.5px var(--text-faint);
    color: var(--on-accent);
    transition:
      background 0.12s var(--ease),
      box-shadow 0.12s var(--ease);
  }
  .checkbox:hover .box {
    box-shadow: inset 0 0 0 1.5px var(--text-muted);
  }
  .checkbox[aria-checked="true"] .box {
    background: var(--accent);
    box-shadow: none;
  }
  .label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
</style>
