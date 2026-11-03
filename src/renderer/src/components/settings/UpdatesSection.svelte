<script lang="ts">
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
  label="État"
  hint={status?.phase === "manual"
    ? "Cette installation ne peut pas se mettre à jour seule (application non signée sur macOS, paquet .deb ou version portable) : téléchargez la nouvelle version depuis sa page."
    : lastCheck
      ? `Dernière vérification : ${lastCheck}`
      : undefined}
>
  <div class="status" role="status" data-phase={status?.phase ?? "disabled"}>
    {#if status?.phase === "downloading"}
      <span class="bar" aria-hidden="true"><span style:width="{status.percent}%"></span></span>
    {/if}
    <span>{status ? updateStatusText(status) : "Mises à jour automatiques indisponibles dans cette version."}</span>
  </div>
</Row>
<div class="actions">
  {#if status?.phase === "ready"}
    <button class="primary" onclick={() => api.updates.install()}><Icon name="update" size={12} /> Redémarrer pour installer</button>
  {:else if status?.phase === "available"}
    <button class="primary" onclick={() => api.updates.download()}><Icon name="download" size={12} /> Télécharger</button>
  {:else if status?.phase === "manual"}
    <button class="primary" onclick={() => api.tabs.create(status.releaseUrl)}><Icon name="open" size={12} /> Mise à jour manuelle requise : ouvrir la page</button>
  {/if}
  <button class="secondary" disabled={!status || isUpdateBusy(status)} onclick={() => api.updates.check()}>
    <Icon name="reload" size={12} /> Rechercher des mises à jour
  </button>
</div>
<Row label="Téléchargement automatique" hint="Télécharge les nouvelles versions en arrière-plan ; elles s'installent au prochain redémarrage.">
  <Toggle
    label="Téléchargement automatique"
    checked={prefs.autoDownload}
    onchange={(autoDownload) => settings.update({ updates: { autoDownload } })}
  />
</Row>
<Row anchor="channel" label="Canal" hint="Bêta : versions préliminaires, plus tôt mais moins éprouvées.">
  <Segmented
    label="Canal de mise à jour"
    value={prefs.channel}
    options={[
      { value: "stable" as UpdateChannel, label: "Stable" },
      { value: "beta" as UpdateChannel, label: "Bêta" },
    ]}
    onchange={(channel) => settings.update({ updates: { channel } })}
  />
</Row>
<div class="beta" data-setting="beta" data-testid="beta-program">
  <strong>Programme bêta</strong>
  <p>
    Le canal Bêta reçoit les nouveautés quelques jours ou semaines avant tout le monde. Elles peuvent contenir des défauts : vos données
    restent les vôtres (même profil, mêmes formats), et revenir au canal Stable se fait ici, la version stable suivante remplaçant la bêta.
    Si quelque chose ne va pas, Aide, Signaler un problème ouvre un formulaire prérempli avec la version et le système, rien d'autre.
    {#if prefs.channel === "beta"}Merci de tester !{/if}
  </p>
  <button class="secondary" onclick={() => api.commands.run("report-issue")}><Icon name="bug" size={12} /> Signaler un problème</button>
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
