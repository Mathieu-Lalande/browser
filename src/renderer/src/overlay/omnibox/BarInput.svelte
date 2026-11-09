<script lang="ts">
  import { t } from "@shared/i18n";
  import { scopeById } from "@shared/omnibox/scopes";
  import Icon from "../../components/Icon.svelte";
  import { iconOf } from "./icons";
  import type { OmniboxController } from "./controller.svelte";

  /** The input, with the scope chip before it (Backspace on an empty input removes the chip). */
  let { bar, input = $bindable() }: { bar: OmniboxController; input?: HTMLInputElement } = $props();

  const scope = $derived(bar.scope ? scopeById(bar.scope) : null);

  $effect(() => {
    input?.focus();
  });

  function onKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    const field = event.currentTarget;
    if (event.key === "Backspace" && bar.scope && field.selectionStart === 0 && field.selectionEnd === 0) {
      event.preventDefault();
      bar.setScope(null);
    }
  }
</script>

<div class="search">
  <span class="glyph"><Icon name="search" size={19} /></span>
  {#if scope}
    <button class="chip" title={t("barInput.removeFilterBackspace")} onclick={() => (bar.setScope(null), input?.focus())}>
      <Icon name={iconOf(scope.icon)} size={13} />
      {scope.label}
      <span class="x"><Icon name="close" size={11} /></span>
    </button>
  {/if}
  <input
    bind:this={input}
    value={bar.input}
    oninput={(event) => bar.setInput(event.currentTarget.value)}
    onkeydown={onKeydown}
    placeholder={scope ? t("barInput.search", { p: scope.label.toLowerCase() }) : t("barInput.tabsPagesActionsSettings")}
    spellcheck="false"
    autocomplete="off"
    aria-label={t("barInput.universalBar")}
    role="combobox"
    aria-expanded="true"
    aria-controls="omnibox-results"
    aria-autocomplete="list"
    aria-activedescendant={bar.items.length ? `omnibox-item-${bar.current}` : undefined}
  />
</div>

<style>
  .search {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    height: 60px;
    padding: 0 16px 0 18px;
    border-bottom: 1px solid var(--border);
  }
  .glyph {
    display: grid;
    color: var(--accent-text);
  }
  .chip {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 6px 0 10px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--accent) 18%, transparent);
    color: var(--accent-text);
    font-size: 12.5px;
    font-weight: 600;
  }
  .chip .x {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    opacity: 0.7;
  }
  .chip:hover .x {
    background: color-mix(in oklab, var(--accent) 25%, transparent);
    opacity: 1;
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-size: 17px;
    letter-spacing: -0.01em;
    user-select: text;
  }
  input::placeholder {
    color: var(--text-faint);
  }
</style>
