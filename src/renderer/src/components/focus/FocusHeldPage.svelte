<script lang="ts">
  import { t } from "@shared/i18n";
  import { focusMinutesLeft } from "@shared/focus";
  import type { TabState } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";

  /** A site held by the focus session (ADR-059): until when, and the ways out. */
  let { tab }: { tab: TabState } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 5000);
    return () => clearInterval(timer);
  });

  const host = $derived.by(() => {
    try {
      return new URL(tab.interstitial?.url ?? "").hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  });
  const left = $derived(browser.state.focus ? focusMinutesLeft(browser.state.focus, now) : 0);
</script>

<section class="held" data-testid="focus-held">
  <span class="badge"><Icon name="hourglass" size={28} /></span>
  <h1>{t("focusHeld.title", { host })}</h1>
  <p>{left ? t("focusHeld.left", { left }) : t("focusHeld.over")}</p>
  <div class="actions">
    {#if tab.canGoBack}
      <button class="secondary" onclick={() => api.tabs.back(tab.id)}>{t("httpsOnlyPage.goBack")}</button>
    {:else}
      <button class="secondary" onclick={() => api.tabs.close(tab.id)}>{t("httpsOnlyPage.closeTab")}</button>
    {/if}
    {#if left}
      <button class="secondary" onclick={() => api.wellbeing.startFocus(null)}>{t("focusHeld.stop")}</button>
    {:else}
      <button class="primary" onclick={() => api.tabs.navigate(tab.id, tab.interstitial?.url ?? "")}>{t("focusHeld.open")}</button>
    {/if}
  </div>
</section>

<style>
  .held {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 100%;
    padding: var(--space-5);
    background:
      radial-gradient(50% 40% at 50% 35%, color-mix(in oklab, var(--accent) min(calc(20% * var(--tint, 1)), 90%), transparent), transparent),
      radial-gradient(40% 40% at 60% 70%, color-mix(in oklab, var(--accent-2) min(calc(14% * var(--tint, 1)), 90%), transparent), transparent);
    text-align: center;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    margin-bottom: var(--space-2);
    border-radius: var(--radius-lg);
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    box-shadow: 0 12px 32px -12px var(--accent);
    color: var(--on-accent);
  }
  h1 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  p {
    margin: 0;
    color: var(--text-muted);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  button {
    height: 32px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
  }
  .secondary {
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
</style>
