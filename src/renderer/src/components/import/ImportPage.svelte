<script lang="ts">
  import { IMPORT_ITEM_LABELS, type ImportItem, type ImportSource, type ImportSummary, type PasswordImportSummary } from "@shared/import/types";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import Checkbox from "../ui/Checkbox.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import ListRow from "../ui/ListRow.svelte";
  import Page from "../ui/Page.svelte";

  /**
   * `browser://import` (ADR-039): pick a browser found on this computer, one of its profiles and what
   * to bring over; passwords come from a CSV export. Never from a private window.
   */

  let sources = $state<ImportSource[] | null>(null);
  let sourceId = $state<string | null>(null);
  let profileId = $state<string | null>(null);
  let items = $state<Set<ImportItem>>(new Set());
  let progress = $state<string | null>(null);
  let summary = $state<ImportSummary | null>(null);
  let passwords = $state<PasswordImportSummary | null>(null);
  let busy = $state(false);

  const source = $derived(sources?.find((candidate) => candidate.id === sourceId) ?? null);
  const profile = $derived(source?.profiles.find((candidate) => candidate.id === profileId) ?? null);

  async function detect(): Promise<void> {
    if (browser.isPrivate) return;
    sources = await api.import.sources().catch(() => []);
    if (!sources.some((candidate) => candidate.id === sourceId)) choose(sources[0] ?? null);
  }

  function choose(next: ImportSource | null): void {
    sourceId = next?.id ?? null;
    pickProfile(next?.profiles[0]?.id ?? null);
    summary = null;
  }

  function pickProfile(id: string | null): void {
    profileId = id;
    const found = source?.profiles.find((candidate) => candidate.id === id) ?? sources?.flatMap((s) => s.profiles).find((candidate) => candidate.id === id);
    items = new Set(found?.items ?? []);
  }

  function toggle(item: ImportItem, checked: boolean): void {
    const next = new Set(items);
    if (checked) next.add(item);
    else next.delete(item);
    items = next;
  }

  async function run(): Promise<void> {
    if (!profileId || !items.size) return;
    busy = true;
    summary = null;
    summary = await api.import.run(profileId, [...items]).catch(() => ({ ok: false, message: "L'import a échoué." }));
    progress = null;
    busy = false;
  }

  async function importPasswords(): Promise<void> {
    passwords = await api.import.passwordsCsv().catch(() => ({ ok: false, message: "L'import a échoué.", added: 0, updated: 0, skipped: 0, invalid: 0 }));
  }

  $effect(() => {
    void detect();
  });
  $effect(() => api.import.onProgress((step) => (progress = step.step === "done" ? null : step.label)));

  const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;
</script>

<Page icon="import" title="Importer des données" subtitle="Favoris, historique et mots de passe d'un autre navigateur, sans doublons." testid="import-page">
  {#if browser.isPrivate}
    <EmptyState icon="mask" title="Import indisponible en navigation privée" hint="Ouvrez une fenêtre normale pour importer vos données." />
  {:else}
    <section class="step">
      <h2>Navigateur</h2>
      {#if sources === null}
        <p class="hint">Recherche des navigateurs installés…</p>
      {:else if sources.length}
        <Card as="ul" role="radiogroup" aria-label="Navigateur source">
          {#each sources as candidate (candidate.id)}
            <ListRow dense class="source" data-source={candidate.id}>
              <button class="pick" role="radio" aria-checked={candidate.id === sourceId} onclick={() => choose(candidate)}>
                <span class="radio" aria-hidden="true">{#if candidate.id === sourceId}<span class="dot"></span>{/if}</span>
                <span class="name">{candidate.name}</span>
                <span class="hint">{plural(candidate.profiles.length, "profil")}</span>
              </button>
            </ListRow>
          {/each}
        </Card>
      {:else}
        <EmptyState icon="search" title="Aucun navigateur trouvé" hint="Chrome, Edge, Brave, Vivaldi, Opera, Firefox et Arc sont reconnus. Les mots de passe s'importent depuis un fichier CSV, ci-dessous." />
      {/if}
    </section>

    {#if source}
      <section class="step">
        <h2>Profil et contenu</h2>
        {#if source.profiles.length > 1}
          <label class="field">
            <span>Profil</span>
            <select class="ui-field" value={profileId} onchange={(event) => pickProfile(event.currentTarget.value)} aria-label="Profil">
              {#each source.profiles as candidate (candidate.id)}<option value={candidate.id}>{candidate.name}</option>{/each}
            </select>
          </label>
        {/if}
        {#if profile}
          <div class="items">
            {#each profile.items as item (item)}
              <Checkbox checked={items.has(item)} onchange={(checked) => toggle(item, checked)}>{IMPORT_ITEM_LABELS[item]}</Checkbox>
            {/each}
          </div>
        {/if}
        <div class="actions">
          <Button variant="primary" icon="import" disabled={busy || !items.size} onclick={run}>Importer</Button>
          {#if progress}<span class="hint" role="status">{progress}</span>{/if}
        </div>
        {#if summary}
          <div class="summary" class:error={!summary.ok} role="status" data-testid="import-summary">
            <Icon name={summary.ok ? "check" : "warning"} size={16} />
            <ul>
              {#if summary.bookmarks}<li>{plural(summary.bookmarks.added, "favori")} importé{summary.bookmarks.added > 1 ? "s" : ""}{summary.bookmarks.skipped ? `, ${summary.bookmarks.skipped} déjà présent${summary.bookmarks.skipped > 1 ? "s" : ""}` : ""}</li>{/if}
              {#if summary.history}<li>{plural(summary.history.added, "page")} ajoutée{summary.history.added > 1 ? "s" : ""} à l'historique{summary.history.merged ? `, ${summary.history.merged} déjà connue${summary.history.merged > 1 ? "s" : ""}` : ""}</li>{/if}
              {#if summary.favorites}<li>{plural(summary.favorites.added, "page")} dans la grille des favoris</li>{/if}
              {#if summary.searchEngine !== undefined}<li>{summary.searchEngine ? `Moteur de recherche : ${summary.searchEngine}` : "Moteur de recherche non reconnu, inchangé"}</li>{/if}
              {#if summary.message}<li>{summary.message}</li>{/if}
            </ul>
          </div>
        {/if}
      </section>
    {/if}

    <section class="step">
      <h2>Mots de passe</h2>
      <p class="hint">
        Les navigateurs chiffrent leurs mots de passe avec une clé du système (ou leur propre coffre) qu'aucune autre application ne devrait lire.
        Exportez-les plutôt en CSV depuis l'autre navigateur (Chrome, Edge : Gestionnaire de mots de passe, Paramètres, Exporter ; Firefox :
        Mots de passe, menu « … », Exporter), importez le fichier ici, puis supprimez-le.
      </p>
      <div class="actions">
        <Button icon="file-spreadsheet" onclick={importPasswords}>Choisir un fichier CSV…</Button>
      </div>
      {#if passwords && !passwords.cancelled}
        <div class="summary" class:error={!passwords.ok} role="status">
          <Icon name={passwords.ok ? "check" : "warning"} size={16} />
          <span>
            {#if passwords.ok}
              {plural(passwords.added, "mot")} de passe ajouté{passwords.added > 1 ? "s" : ""}, {passwords.updated} mis à jour, {passwords.skipped} déjà
              présent{passwords.skipped > 1 ? "s" : ""}{passwords.invalid ? `, ${passwords.invalid} ignoré${passwords.invalid > 1 ? "s" : ""}` : ""}.
            {:else}
              {passwords.message}
            {/if}
          </span>
        </div>
      {/if}
    </section>
  {/if}
</Page>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h2 {
    margin: var(--space-3) 0 0;
    font-size: var(--text-md);
    font-weight: 600;
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .pick {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    padding: 0;
    color: inherit;
    text-align: left;
  }
  .name {
    flex: 1;
  }
  .radio {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--text-faint);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .summary {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius);
    background: var(--surface-hover);
    font-size: var(--text-sm);
  }
  .summary.error {
    color: var(--danger-text);
  }
  .summary ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
