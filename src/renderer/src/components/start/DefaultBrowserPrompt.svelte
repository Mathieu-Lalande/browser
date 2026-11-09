<script lang="ts">
  import { t } from "@shared/i18n";
  import type { DefaultBrowserStatus } from "@shared/default-browser";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";

  /**
   * The one-time card of the start page (ADR-039): offers to become the default browser, until it
   * is answered either way. Never in a private window, nor when the OS cannot be asked (dev runs).
   */

  let status = $state<DefaultBrowserStatus | null>(null);
  const dismissed = $derived(settings.current.behavior.defaultBrowserPromptDismissed);

  $effect(() => {
    if (browser.isPrivate || dismissed) return;
    void api.defaultBrowser.status().then((current) => (status = current), () => {});
  });

  const answer = () => settings.update({ behavior: { defaultBrowserPromptDismissed: true } });

  async function makeDefault(): Promise<void> {
    status = await api.defaultBrowser.makeDefault().catch(() => status);
    answer();
  }
</script>

{#if !browser.isPrivate && !dismissed && status?.state === "not-default"}
  <div class="prompt" role="region" aria-label={t("defaultBrowserPrompt.defaultBrowser")}>
    <Icon name="badge-check" size={18} />
    <span class="text">{t("defaultBrowserPrompt.makeBrowserDefaultBrowser")}</span>
    <Button size="sm" variant="primary" onclick={makeDefault}>{t("defaultBrowserPrompt.makeDefault")}</Button>
    <Button size="sm" variant="quiet" onclick={answer}>{t("defaultBrowserPrompt.later")}</Button>
  </div>
{/if}

<style>
  .prompt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    align-self: center;
    max-width: 640px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    font-size: var(--text-sm);
  }
  .text {
    flex: 1;
  }
</style>
