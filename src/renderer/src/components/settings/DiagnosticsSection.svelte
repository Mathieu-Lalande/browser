<script lang="ts">
  import { t } from "@shared/i18n";
  import { crashSizeText, type CrashReportsInfo } from "@shared/diagnostics";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Button from "../ui/Button.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /**
   * Settings > Diagnostic (ADR-043): the crash report opt-in (off by default), what it sends, the
   * crashes kept on this device, and "Signaler un problème".
   */

  let info = $state<CrashReportsInfo | null>(null);
  const enabled = $derived(settings.current.diagnostics.crashReports);

  async function refresh(): Promise<void> {
    info = await api.crashes.info().catch(() => null);
  }

  $effect(() => {
    void enabled;
    void refresh();
  });

  async function clear(): Promise<void> {
    info = await api.crashes.clear().catch(() => info);
  }

  const date = (ms: number) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  const hint = $derived(
    info && !info.endpointHost
      ? t("diagnosticsSection.versionHasNoReport")
      : `Envoie le rapport technique d'un plantage${info?.endpointHost ? ` à ${info.endpointHost}` : ""}. Désactivé par défaut.`,
  );
</script>

<Row anchor="crash-reports" label={t("diagnosticsSection.sendCrashReports")} {hint} keywords={t("diagnosticsSection.crashReportMinidumpSentry")}>
  <Toggle
    label={t("diagnosticsSection.sendCrashReports")}
    checked={enabled}
    onchange={(crashReports) => settings.update({ diagnostics: { crashReports } })}
  />
</Row>
<p class="privacy" data-testid="crash-privacy">
  Un rapport contient l'état de la mémoire du processus qui a planté (minidump), la version de Browser, le canal de mise à jour et le
  système. Il peut, rarement, contenir des fragments de la page affichée à ce moment-là. Aucun historique, favori, mot de passe ni
  identifiant n'y est ajouté, et rien n'est envoyé sans votre accord.{info?.uploading ? " Envoi activé." : ""}
</p>

<Row anchor="crashes" label={t("diagnosticsSection.recentCrashes")} hint={t("diagnosticsSection.keptDeviceEvenWithout")} stacked keywords={t("diagnosticsSection.crashHistory")}>
  {#if info?.crashes.length}
    <ul class="crashes" data-testid="crash-list">
      {#each info.crashes as crash (crash.id)}
        <li>
          <span>{date(crash.date)}</span>
          <span class="muted">{crashSizeText(crash.sizeBytes)}{crash.state === "pending" ? t("diagnosticsSection.pending") : ""}</span>
        </li>
      {/each}
    </ul>
    <div class="actions">
      {#if info.uploadedCount}<span class="muted">{t("diagnosticsSection.reportsSent", { uploadedCount: info.uploadedCount })}</span>{/if}
      <Button variant="quiet" icon="trash" disabled={browser.isPrivate} onclick={clear}>{t("diagnosticsSection.clearReports")}</Button>
    </div>
  {:else}
    <p class="muted" data-testid="crash-list-empty">{t("diagnosticsSection.noCrashesRecorded")}</p>
  {/if}
</Row>

<Row anchor="report-issue" label={t("diagnosticsSection.reportProblem")} hint={t("diagnosticsSection.opensFormGithubPrefilled")}>
  <Button icon="bug" onclick={() => api.commands.run("report-issue")}>{t("diagnosticsSection.reportProblem")}</Button>
</Row>

<style>
  .privacy {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.5;
  }
  .crashes {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }
  .crashes li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
