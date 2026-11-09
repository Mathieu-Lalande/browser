<script lang="ts">
  import { t } from "@shared/i18n";
  import type { UpdateChannel } from "@shared/settings";
  import { isUpdateBusy, updateStatusText } from "@shared/updates";
  import { api } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import { updates } from "../../lib/updates.svelte";
  import Icon from "../Icon.svelte";
  import Row from "../ui/Row.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import Toggle from "../ui/Toggle.svelte";

  const prefs = $derived(settings.current.updates);
  const status = $derived(updates.status);
  const lastCheck = $derived(
    status?.lastCheck
      ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(status.lastCheck))
      : null,
  );
</script>

<Row
  label={t("updatesSection.status")}
  hint={status?.phase === "manual"
    ? t("updatesSection.installationCantUpdateItself")
    : lastCheck
      ? t("updatesSection.lastCheck", { lastCheck })
      : undefined}
>
  <div class="status" role="status" data-phase={status?.phase ?? "disabled"}>
    {#if status?.phase === "downloading"}
      <span class="bar" aria-hidden="true"><span style:width="{status.percent}%"></span></span>
    {/if}
    <span>{status ? updateStatusText(status) : t("updatesSection.automaticUpdatesUnavailableVersion")}</span>
  </div>
</Row>
<div class="actions">
  {#if status?.phase === "ready"}
    <button class="primary" onclick={() => api.updates.install()}><Icon name="update" size={12} /> {t("updatesSection.restartInstall")}</button>
  {:else if status?.phase === "available"}
    <button class="primary" onclick={() => api.updates.download()}><Icon name="download" size={12} /> {t("updatesSection.download")}</button>
  {:else if status?.phase === "manual"}
    <button class="primary" onclick={() => api.tabs.create(status.releaseUrl)}><Icon name="open" size={12} /> {t("updatesSection.manualUpdateRequiredOpen")}</button>
  {/if}
  <button class="secondary" disabled={!status || isUpdateBusy(status)} onclick={() => api.updates.check()}>
    <Icon name="reload" size={12} /> {t("updatesSection.checkUpdates")}
  </button>
</div>
<Row label={t("updatesSection.automaticDownload")} hint={t("updatesSection.downloadsNewVersionsBackground")}>
  <Toggle
    label={t("updatesSection.automaticDownload")}
    checked={prefs.autoDownload}
    onchange={(autoDownload) => settings.update({ updates: { autoDownload } })}
  />
</Row>
<Row anchor="channel" label={t("updatesSection.channel")} hint={t("updatesSection.betaPreviewVersionsEarlier")}>
  <Segmented
    label={t("updatesSection.updateChannel")}
    value={prefs.channel}
    options={[
      { value: "stable" as UpdateChannel, label: "Stable" },
      { value: "beta" as UpdateChannel, label: t("updatesSection.beta") },
    ]}
    onchange={(channel) => settings.update({ updates: { channel } })}
  />
</Row>
<div class="beta" data-setting="beta" data-testid="beta-program">
  <strong>{t("updatesSection.betaProgram")}</strong>
  <p>
    {t("updatesSection.betaChannelGetsNew")}
    {#if prefs.channel === "beta"}{t("updatesSection.thanksTesting")}{/if}
  </p>
  <button class="secondary" onclick={() => api.commands.run("report-issue")}><Icon name="bug" size={12} /> {t("updatesSection.reportProblem")}</button>
</div>

<style>
  .beta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    margin-top: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-hover);
    font-size: var(--text-sm);
  }
  .beta p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.5;
  }
  .status {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    color: var(--text-muted);
    font-size: 12px;
    text-align: right;
  }
  .status[data-phase="ready"],
  .status[data-phase="available"],
  .status[data-phase="manual"] {
    color: var(--accent-text);
    font-weight: 500;
  }
  .bar {
    display: block;
    width: 160px;
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--surface-active);
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    padding: 0 18px 12px;
  }
  .primary,
  .secondary {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    white-space: nowrap;
  }
  .primary {
    border-color: transparent;
    background: var(--accent);
    color: var(--on-accent);
  }
  .secondary:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .secondary:disabled {
    opacity: 0.5;
  }
</style>
