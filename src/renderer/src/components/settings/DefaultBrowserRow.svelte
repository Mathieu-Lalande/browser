<script lang="ts">
  import { t } from "@shared/i18n";
  import type { DefaultBrowserStatus } from "@shared/default-browser";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Row from "../ui/Row.svelte";

  /** Settings > Comportement: "Navigateur par défaut" (ADR-039). */

  let status = $state<DefaultBrowserStatus | null>(null);

  $effect(() => {
    void api.defaultBrowser.status().then((current) => (status = current), () => {});
  });

  async function makeDefault(): Promise<void> {
    status = await api.defaultBrowser.makeDefault().catch(() => status);
  }

  const hint = $derived(
    status?.message ?? (status?.state === "default" ? t("defaultBrowserRow.linksOpenedFromOther") : t("defaultBrowserRow.openLinksFromOther")),
  );
</script>

<Row anchor="default-browser" label={t("defaultBrowserRow.defaultBrowser")} {hint} keywords={t("defaultBrowserRow.defaultLinksHttpPdf")}>
  {#if status?.state === "default"}
    <span class="done" data-testid="default-browser-state"><Icon name="badge-check" size={14} /> {t("defaultBrowserRow.defaultBrowser")}</span>
  {:else}
    <Button icon="badge-check" disabled={status?.state !== "not-default"} onclick={makeDefault}>{t("defaultBrowserRow.makeDefault")}</Button>
  {/if}
</Row>

<style>
  .done {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
</style>
