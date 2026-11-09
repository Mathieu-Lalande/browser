<script lang="ts">
  import { t } from "@shared/i18n";
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
  <input bind:this={input} bind:value={query} placeholder={t("searchWidget.searchWebEnterAddress")} spellcheck="false" />
</form>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: min(620px, 100%);
    height: 52px;
    margin: 0 auto;
    padding: 0 var(--space-4);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius-lg) + var(--space-1));
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
    font-size: var(--text-md);
    user-select: text;
  }
</style>
