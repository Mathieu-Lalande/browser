<script lang="ts">
  import type { FindState, TabId } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import Icon from "./Icon.svelte";

  /**
   * Find in page. A strip above the page (it shrinks the viewport, like the permission bar): the
   * chrome UI cannot draw over the native page view, and an overlay would block the page (ADR-013).
   * Remounted per tab: each tab keeps its own query (stored in main).
   */
  let { tabId, find }: { tabId: TabId; find: FindState } = $props();

  let input: HTMLInputElement;
  // Seeded from the tab's last query; afterwards the field leads and main follows.
  // svelte-ignore state_referenced_locally
  let draft = $state(find.query);

  const count = $derived(find.matches > 0 ? `${find.activeMatch}/${find.matches}` : draft ? "0/0" : "");
  const notFound = $derived(draft !== "" && find.query === draft && find.matches === 0);

  export function focus(): void {
    input.focus();
    input.select();
  }

  function onInput(): void {
    api.find.query(tabId, draft, find.matchCase);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      api.find.step(tabId, !event.shiftKey);
    } else if (event.key === "Escape") {
      event.preventDefault();
      api.find.close(tabId);
    }
  }
</script>

<div class="find-bar" role="search" aria-label="Rechercher dans la page">
  <label class="field" class:not-found={notFound}>
    <Icon name="search" size={16} />
    <input
      bind:this={input}
      bind:value={draft}
      oninput={onInput}
      onkeydown={onKeydown}
      placeholder="Rechercher dans la page"
      aria-label="Rechercher dans la page"
      spellcheck="false"
      autocomplete="off"
    />
    <span class="count" aria-live="polite" data-testid="find-count">{count}</span>
  </label>
  <button
    class="case"
    class:on={find.matchCase}
    aria-pressed={find.matchCase}
    aria-label="Respecter la casse"
    title="Respecter la casse"
    onclick={() => api.find.query(tabId, draft, !find.matchCase)}
  >
    Aa
  </button>
  <div class="steps">
    <button aria-label="Occurrence précédente" title="Occurrence précédente (Maj+Entrée)" disabled={!find.matches} onclick={() => api.find.step(tabId, false)}>
      <Icon name="chevron-up" size={16} />
    </button>
    <button aria-label="Occurrence suivante" title="Occurrence suivante (Entrée)" disabled={!find.matches} onclick={() => api.find.step(tabId, true)}>
      <Icon name="chevron-down" size={16} />
    </button>
  </div>
  <button class="close" aria-label="Fermer la recherche" title="Fermer (Échap)" onclick={() => api.find.close(tabId)}>
    <Icon name="close" size={12} />
  </button>
</div>

<style>
  .find-bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    height: 42px;
    padding: 0 6px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    box-shadow: 0 0 0 1px var(--border);
    animation: drop 0.16s var(--ease);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    width: min(420px, 100%);
    height: 30px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-faint);
    transition:
      border-color 0.15s var(--ease),
      box-shadow 0.15s var(--ease);
  }
  .field:focus-within {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
    background: var(--bg-elevated);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent);
  }
  .field.not-found {
    border-color: color-mix(in oklab, #e5484d 70%, transparent);
    box-shadow: 0 0 0 3px color-mix(in oklab, #e5484d 16%, transparent);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    user-select: text;
  }
  input::placeholder {
    color: var(--text-faint);
  }
  .count {
    color: var(--text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .not-found .count {
    color: #e5484d;
  }
  button {
    display: grid;
    place-items: center;
    height: 30px;
    border-radius: 7px;
    color: var(--text-muted);
  }
  button:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }
  button:disabled {
    opacity: 0.35;
  }
  .case {
    width: 34px;
    font-size: 12.5px;
    font-weight: 600;
  }
  .case.on {
    background: color-mix(in oklab, var(--accent) 18%, transparent);
    color: var(--accent-text);
  }
  .steps {
    display: flex;
  }
  .steps button {
    width: 30px;
  }
  .close {
    width: 30px;
    margin-left: auto;
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
</style>
