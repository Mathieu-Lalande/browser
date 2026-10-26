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
  const showShield = $derived(!!tab && /^https?:/.test(tab.url) && !tab.interstitial);
  const shieldTitle = $derived(
    tab?.shieldsEnabled
      ? `Protections activées : ${tab.blockedCount} élément${tab.blockedCount > 1 ? "s" : ""} bloqué${tab.blockedCount > 1 ? "s" : ""}. Cliquer pour les désactiver sur ce site.`
      : "Protections désactivées sur ce site. Cliquer pour les réactiver.",
  );

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
  {#if tab && showShield}
    <button
      type="button"
      class="shield"
      class:off={!tab.shieldsEnabled}
      title={shieldTitle}
      aria-label={shieldTitle}
      aria-pressed={tab.shieldsEnabled}
      onclick={() => tab && api.tabs.toggleShields(tab.id)}
    >
      <Icon name={tab.shieldsEnabled ? "shield" : "shield-off"} size={13} />
      {#if tab.shieldsEnabled && tab.blockedCount > 0}<span class="count">{tab.blockedCount > 99 ? "99+" : tab.blockedCount}</span>{/if}
    </button>
  {/if}
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
  .shield {
    display: flex;
    flex: none;
    align-items: center;
    gap: 3px;
    height: 24px;
    margin-right: -4px;
    padding: 0 6px;
    border-radius: 7px;
    color: var(--accent);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .shield:hover {
    background: var(--surface-hover);
  }
  .shield.off {
    color: var(--text-faint);
  }
  input::placeholder {
    color: var(--text-faint);
  }
</style>
