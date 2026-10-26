<script lang="ts">
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../lib/browser.svelte";
  import Icon from "./Icon.svelte";

  let input: HTMLInputElement;
  let focused = $state(false);
  let draft = $state("");

  const tab = $derived(browser.activeTab);
  const isSecure = $derived(tab?.url.startsWith("https://") ?? false);
  const label = $derived(tab?.url ? displayUrl(tab.url) : "");

  export function focus(): void {
    input.focus();
    input.select();
  }

  function onFocus(): void {
    focused = true;
    draft = tab?.url ?? "";
    queueMicrotask(() => input.select());
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (tab) api.tabs.navigate(tab.id, draft);
    else api.tabs.create(draft);
    input.blur();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      draft = tab?.url ?? "";
      input.blur();
    }
  }
</script>

<form class="address no-drag" class:focused onsubmit={submit}>
  <span class="status" class:secure={isSecure} title={isSecure ? "Connexion sécurisée" : undefined}>
    <Icon name={!tab?.url ? "search" : isSecure ? "lock" : "warning"} size={13} />
  </span>
  <input
    bind:this={input}
    value={focused ? draft : label}
    oninput={(event) => (draft = event.currentTarget.value)}
    onfocus={onFocus}
    onblur={() => (focused = false)}
    onkeydown={onKeydown}
    placeholder="Rechercher ou saisir une adresse"
    spellcheck="false"
    autocomplete="off"
    aria-label="Barre d'adresse"
  />
</form>

<style>
  .address {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: var(--surface);
    transition:
      background 0.15s var(--ease),
      border-color 0.15s var(--ease),
      box-shadow 0.15s var(--ease);
  }
  .address:hover {
    background: var(--surface-hover);
  }
  .address.focused {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
    background: var(--bg-elevated);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 20%, transparent);
  }
  .status {
    display: grid;
    color: var(--text-faint);
  }
  .status.secure {
    color: var(--text-muted);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font-size: 13px;
    user-select: text;
  }
  input::placeholder {
    color: var(--text-faint);
  }
</style>
