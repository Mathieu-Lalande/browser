<script lang="ts">
  import { t } from "@shared/i18n";
  import Icon from "../Icon.svelte";

  /** The search box of pages (settings, downloads, archive, passwords…): icon, field, clear button. */
  let {
    value = $bindable(""),
    label,
    placeholder = label,
    element = $bindable(),
  }: { value?: string; label: string; placeholder?: string; element?: HTMLInputElement } = $props();
</script>

<label class="search">
  <Icon name="search" size={16} />
  <input
    bind:this={element}
    bind:value
    type="search"
    {placeholder}
    aria-label={label}
    spellcheck="false"
    autocomplete="off"
    onkeydown={(event) => event.key === "Escape" && value && (event.preventDefault(), (value = ""))}
  />
  {#if value}
    <button type="button" class="clear" aria-label={t("searchField.clearSearch")} title={t("searchField.clearSearch")} onclick={() => ((value = ""), element?.focus())}>
      <Icon name="close" size={14} />
    </button>
  {/if}
</label>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 36px;
    min-width: 0;
    padding: 0 var(--space-1) 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text-faint);
    transition:
      border-color var(--motion-fast) var(--ease),
      box-shadow var(--motion-fast) var(--ease);
  }
  .search:focus-within {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
    box-shadow: var(--focus-ring);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    user-select: text;
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  input::placeholder {
    color: var(--text-faint);
  }
  .clear {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--hit-min);
    height: var(--hit-min);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }
  .clear:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
</style>
