<script lang="ts">
  import { t } from "@shared/i18n";
  import type { DefaultBrowserStatus } from "@shared/default-browser";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";

  /** Welcome, step 4 (ADR-043): the settings' "Navigateur par défaut" row (ADR-039), larger. */

  let status = $state<DefaultBrowserStatus | null>(null);

  $effect(() => {
    void api.defaultBrowser.status().then((current) => (status = current), () => {});
  });

  async function makeDefault(): Promise<void> {
    status = await api.defaultBrowser.makeDefault().catch(() => status);
  }

  const hint = $derived(
    status?.message ??
      (status?.state === "not-default"
        ? t("welcomeDefault.systemMayAskYou")
        : t("welcomeDefault.unavailableVersionYouCan")),
  );
</script>

<div class="box" data-testid="welcome-default">
  {#if status?.state === "default"}
    <p class="done" role="status"><Icon name="badge-check" size={18} /> {t("welcomeDefault.browserDefaultBrowser")}</p>
  {:else}
    <Button variant="primary" icon="badge-check" disabled={status?.state !== "not-default"} onclick={makeDefault}>{t("welcomeDefault.setDefaultBrowser")}</Button>
    <p class="hint">{hint}</p>
  {/if}
</div>

<style>
  .box {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .done {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--accent-text);
    font-size: var(--text-md);
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>
