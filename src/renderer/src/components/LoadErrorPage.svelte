<script lang="ts">
  import { describeLoadError, type LoadError, type LoadErrorFamily } from "@shared/load-error";
  import type { TabState } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import Icon, { type IconName } from "./Icon.svelte";

  /**
   * Shown instead of Chromium's blank error page when a page fails to load (the tab's view is
   * detached meanwhile, like the HTTPS-Only interstitial). "Actualiser" reloads the address.
   */
  let { tab, error }: { tab: TabState; error: LoadError } = $props();

  const ICONS: Record<LoadErrorFamily, IconName> = {
    dns: "globe-off",
    offline: "wifi-off",
    refused: "server-off",
    reset: "unplug",
    timeout: "hourglass",
    certificate: "shield-alert",
    redirects: "repeat",
    unreachable: "server-off",
    blocked: "shield-alert",
    other: "warning",
  };

  const text = $derived(describeLoadError(error));
</script>

<section class="load-error" aria-labelledby="load-error-title" data-family={text.family}>
  <span class="badge"><Icon name={ICONS[text.family]} size={24} /></span>
  <h1 id="load-error-title">{text.title}</h1>
  <p>{text.message}</p>
  <p class="muted">{text.advice}</p>
  <div class="actions">
    <button class="primary" disabled={tab.isLoading} title={platform.tip("Actualiser", "reload")} onclick={() => api.tabs.reload(tab.id)}>
      <Icon name="reload" size={16} />
      {tab.isLoading ? "Chargement…" : "Actualiser"}
    </button>
  </div>
  <details>
    <summary>Détails</summary>
    <dl>
      <dt>Adresse</dt>
      <dd>{error.url}</dd>
      <dt>Erreur</dt>
      <dd><code>{error.description || "Erreur inconnue"}</code> ({error.code})</dd>
    </dl>
  </details>
</section>

<style>
  .load-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 100%;
    padding: 24px;
    overflow-y: auto;
    text-align: center;
    animation: rise 0.25s var(--ease);
  }
  .badge {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    margin-bottom: 10px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border);
    color: var(--text-muted);
  }
  [data-family="certificate"] .badge,
  [data-family="blocked"] .badge {
    background: color-mix(in oklab, #e5484d 14%, transparent);
    color: #e5484d;
  }
  h1 {
    margin: 0 0 6px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  p {
    max-width: 480px;
    margin: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--text-muted);
    font-size: 12.5px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 20px;
  }
  .primary {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 16px;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 500;
  }
  .primary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--accent) 88%, var(--on-accent));
  }
  .primary:disabled {
    opacity: 0.6;
  }
  details {
    max-width: 480px;
    margin-top: 18px;
    color: var(--text-faint);
    font-size: 12px;
    user-select: text;
  }
  summary {
    border-radius: 6px;
    list-style-position: inside;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 10px 0 0;
    text-align: left;
  }
  dt {
    color: var(--text-faint);
  }
  dd {
    margin: 0;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
