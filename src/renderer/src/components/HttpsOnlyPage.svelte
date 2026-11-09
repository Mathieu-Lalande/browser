<script lang="ts">
  import { t } from "@shared/i18n";
  import type { TabState } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import Icon from "./Icon.svelte";

  let { tab }: { tab: TabState } = $props();

  const host = $derived.by(() => {
    try {
      return new URL(tab.interstitial?.url ?? "").host;
    } catch {
      return "";
    }
  });
</script>

<section class="interstitial">
  <span class="badge"><Icon name="warning" size={24} /></span>
  <h1>{t("httpsOnlyPage.secureConnectionUnavailable")}</h1>
  <p>
    {t("httpsOnlyPage.httpsOnlyModeTried")} <strong>{host}</strong>{t("httpsOnlyPage.withoutSuccessSiteMay")}
  </p>
  <p class="muted">
    {t("httpsOnlyPage.overHttpInformationExchanged")}
  </p>
  <div class="actions">
    {#if tab.canGoBack}
      <button class="secondary" onclick={() => api.tabs.back(tab.id)}>{t("httpsOnlyPage.goBack")}</button>
    {:else}
      <!-- Nothing to go back to (address typed in a new tab): offer a way out instead. -->
      <button class="secondary" onclick={() => api.tabs.navigate(tab.id, "")}>{t("httpsOnlyPage.startPage")}</button>
      <button class="secondary" onclick={() => api.tabs.close(tab.id)}>{t("httpsOnlyPage.closeTab")}</button>
    {/if}
    <button class="primary" onclick={() => api.tabs.proceedHttp(tab.id)}>{t("httpsOnlyPage.continueOverHttp")}</button>
  </div>
</section>

<style>
  .interstitial {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 100%;
    padding: 24px;
    text-align: center;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    margin-bottom: 8px;
    border-radius: 14px;
    background: color-mix(in oklab, #f5a524 18%, transparent);
    color: #f5a524;
  }
  h1 {
    margin: 0 0 6px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  p {
    max-width: 520px;
    margin: 0;
    color: var(--text);
  }
  .muted {
    margin-top: 6px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 18px;
  }
  button {
    height: 34px;
    padding: 0 16px;
    border-radius: 9px;
    font-weight: 500;
  }
  button:disabled {
    opacity: 0.4;
  }
  .secondary {
    background: var(--surface);
  }
  .secondary:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
</style>
