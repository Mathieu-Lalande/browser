<script lang="ts">
  import { MIN_PASSPHRASE, type BackupMode, type BackupSection, type BackupSummary } from "@shared/backup";
  import { api } from "../../lib/browser.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import Checkbox from "../ui/Checkbox.svelte";
  import Segmented from "../ui/Segmented.svelte";

  /**
   * Backup of the open profile (ADR-042): export to a `.browserbackup` file (passwords only when
   * asked for, sealed with a passphrase), import with a summary first, then merge or replace.
   * Cookies and site data are never part of a backup.
   */

  const LABELS: Record<BackupSection | "passwords", string> = {
    settings: "Réglages",
    bookmarks: "Favoris",
    favorites: "Grille des favoris",
    history: "Pages de l'historique",
    session: "Fenêtres de la session",
    boosts: "Boosts",
    annotations: "Notes et surlignages",
    archive: "Onglets archivés",
    passwords: "Mots de passe",
  };

  let withPasswords = $state(false);
  let exportSecret = $state("");
  let exportMessage = $state("");
  let summary = $state<BackupSummary | null>(null);
  let mode = $state<BackupMode>("merge");
  let importSecret = $state("");
  let importMessage = $state("");
  let busy = $state(false);

  const exportReady = $derived(!withPasswords || exportSecret.length >= MIN_PASSPHRASE);

  async function doExport(): Promise<void> {
    busy = true;
    const result = await api.backup.export(withPasswords ? exportSecret : null).catch(() => ({ ok: false as const, message: "L'export a échoué." }));
    busy = false;
    exportMessage = result.ok ? "Sauvegarde enregistrée." : result.message;
    if (result.ok) exportSecret = "";
  }

  async function pick(): Promise<void> {
    importMessage = "";
    const result = await api.backup.inspect().catch(() => ({ ok: false as const, message: "Le fichier n'a pas pu être lu." }));
    if (result.ok) summary = result.summary;
    else importMessage = result.message;
  }

  async function apply(): Promise<void> {
    busy = true;
    const secret = summary?.hasPasswords && importSecret ? importSecret : null;
    const result = await api.backup.apply(mode, secret).catch(() => ({ ok: false as const, message: "L'import a échoué." }));
    busy = false;
    if (result.ok) {
      summary = null;
      importSecret = "";
      importMessage = "Sauvegarde importée.";
    } else importMessage = result.message;
  }

  const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });
</script>

<h2 class="heading">Sauvegarde du profil</h2>
<Card as="div" variant="section" data-testid="backup">
  <div class="block">
    <p class="intro">Exporte les réglages, favoris, historique, sessions, boosts, notes et la page d'accueil dans un fichier. Les cookies n'en font jamais partie.</p>
    <Checkbox checked={withPasswords} onchange={(checked) => (withPasswords = checked)}>Inclure les mots de passe (chiffrés avec une phrase secrète)</Checkbox>
    {#if withPasswords}
      <input
        class="ui-field"
        type="password"
        autocomplete="new-password"
        aria-label="Phrase secrète de la sauvegarde"
        placeholder="Phrase secrète ({MIN_PASSPHRASE} caractères au moins)"
        bind:value={exportSecret}
      />
    {/if}
    <div class="buttons">
      <Button icon="file-down" disabled={busy || !exportReady} onclick={doExport}>Exporter le profil…</Button>
      {#if exportMessage}<span class="message" role="status">{exportMessage}</span>{/if}
    </div>
  </div>

  <div class="block">
    <div class="buttons">
      <Button icon="file-up" disabled={busy} onclick={pick}>Importer une sauvegarde…</Button>
      {#if importMessage}<span class="message" role="status">{importMessage}</span>{/if}
    </div>
    {#if summary}
      <div class="summary" aria-label="Contenu de la sauvegarde">
        <p>
          Sauvegarde{summary.profileName ? ` du profil « ${summary.profileName} »` : ""}{summary.createdAt ? `, ${dateFormat.format(summary.createdAt)}` : ""} :
        </p>
        <ul>
          {#each Object.entries(summary.counts) as [section, count] (section)}
            <li>{LABELS[section as BackupSection]} : {count}</li>
          {/each}
          {#if summary.hasPasswords}<li>{LABELS.passwords} (chiffrés)</li>{/if}
        </ul>
        <Segmented
          label="Import"
          value={mode}
          options={[
            { value: "merge" as BackupMode, label: "Fusionner" },
            { value: "replace" as BackupMode, label: "Remplacer" },
          ]}
          onchange={(value) => (mode = value)}
        />
        <p class="hint">
          {mode === "merge" ? "Ajoute ce qui manque, garde vos réglages et vos données actuelles." : "Remplace les réglages et les données de ce profil par ceux de la sauvegarde."}
        </p>
        {#if summary.hasPasswords}
          <input
            class="ui-field"
            type="password"
            autocomplete="off"
            aria-label="Phrase secrète pour les mots de passe"
            placeholder="Phrase secrète (laisser vide pour ignorer les mots de passe)"
            bind:value={importSecret}
          />
        {/if}
        <div class="buttons">
          <Button variant="quiet" onclick={() => (summary = null)}>Annuler</Button>
          <Button variant={mode === "replace" ? "danger" : "primary"} disabled={busy} onclick={apply}>{mode === "merge" ? "Fusionner" : "Remplacer"}</Button>
        </div>
      </div>
    {/if}
  </div>
</Card>

<style>
  .heading {
    margin: var(--space-5) 0 var(--space-2);
    font-size: var(--text-md);
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .block + .block {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }
  .intro,
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .message {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .summary {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .summary p {
    margin: 0;
  }
  .summary ul {
    margin: 0;
    padding-left: var(--space-4);
    color: var(--text-muted);
  }
</style>
