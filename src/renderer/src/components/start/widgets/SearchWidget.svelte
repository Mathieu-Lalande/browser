<script lang="ts">
  import Icon from "../../Icon.svelte";
  import { openHere, type WidgetProps } from "../types";

  let { editing }: WidgetProps<"search"> = $props();
  let query = $state("");
  let input = $state<HTMLInputElement>();

  // Focused when the page opens (not while the layout is being edited).
  $effect(() => {
    if (!editing) input?.focus();
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (query.trim()) openHere(query);
  }
</script>

<form class="search" onsubmit={submit}>
  <Icon name="search" size={20} />
  <input bind:this={input} bind:value={query} placeholder="Rechercher sur le web ou saisir une adresse" spellcheck="false" />
</form>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 12px;
    width: min(620px, 100%);
    height: 52px;
    margin: 0 auto;
    padding: 0 18px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg-elevated);
    color: var(--text-faint);
    box-shadow: 0 20px 60px -20px color-mix(in oklab, var(--accent) 45%, transparent);
  }
  .search:focus-within {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-size: 16px;
    user-select: text;
  }
</style>
