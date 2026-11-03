<script lang="ts">
  import { internalUrl } from "@shared/internal";
  import type { ImportSource, ImportSummary } from "@shared/import/types";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";

  /**
   * Welcome, step 3 (ADR-043): the browsers `ImportService` finds (ADR-039), one click to bring
   * over everything their first profile offers. `browser://import` keeps the detailed choices.
   */

  let sources = $state<ImportSource[] | null>(null);
  let chosen = $state<string | null>(null);
  let busy = $state(false);
  let summary = $state<ImportSummary | null>(null);

  const source = $derived(sources?.find((candidate) => candidate.id === chosen) ?? null);

  $effect(() => {
    if (browser.isPrivate) return;
    void api.import
      .sources()
      .catch(() => [])
      .then((found) => {
        sources = found.filter((candidate) => candidate.profiles.length > 0);
        chosen = sources[0]?.id ?? null;
      });
  });

  async function run(): Promise<void> {
    const profile = source?.profiles[0];
    if (!profile || busy) return;
    busy = true;
    summary = await api.import.run(profile.id, [...profile.items]).catch(() => ({ ok: false, message: "L'import a échoué." }));
    busy = false;
  }

  const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;
  const summaryText = (result: ImportSummary): string => {
    if (!result.ok) return result.message ?? "L'import a échoué.";
    const parts = [
      result.bookmarks && plural(result.bookmarks.added, "favori"),
      result.history && `${plural(result.history.added, "page")} d'historique`,
      result.searchEngine && `moteur ${result.searchEngine}`,
    ].filter(Boolean);
    return parts.length ? `Importé : ${parts.join(", ")}.` : "Rien de nouveau à importer.";
  };
</script>

<div class="import" data-testid="welcome-import">
  {#if browser.isPrivate}
    <p class="hint">L'import est indisponible en navigation privée.</p>
  {:else if sources === null}
    <p class="hint">Recherche des navigateurs installés…</p>
  {:else if sources.length === 0}
    <p class="hint">
      <Icon name="search" size={14} /> Aucun autre navigateur trouvé sur cet ordinateur. Vous pourrez importer plus tard (favoris HTML, mots de passe CSV) depuis
      Fichier, Importer des données.
    </p>
  {:else}
    <div class="sources" role="radiogroup" aria-label="Navigateur à importer">
      {#each sources as candidate (candidate.id)}
        <button class="source" role="radio" aria-checked={candidate.id === chosen} onclick={() => ((chosen = candidate.id), (summary = null))}>
          <span class="radio" aria-hidden="true">{#if candidate.id === chosen}<span class="dot"></span>{/if}</span>
          {candidate.name}
        </button>
      {/each}
    </div>
    <div class="actions">
      <Button variant="primary" icon="import" disabled={busy || !source} onclick={run}>{busy ? "Import en cours…" : `Importer depuis ${source?.name ?? "…"}`}</Button>
      <Button variant="quiet" onclick={() => api.tabs.create(internalUrl("import"))}>Plus d'options</Button>
    </div>
    {#if summary}
      <p class="summary" class:error={!summary.ok} role="status" data-testid="welcome-import-summary">
        <Icon name={summary.ok ? "check" : "warning"} size={14} />
        {summaryText(summary)}
      </p>
    {/if}
  {/if}
</div>

<style>
  .import {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .source {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--hit-min);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-size: var(--text-sm);
  }
  .source[aria-checked="true"] {
    border-color: var(--accent-text);
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
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .hint,
  .summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .summary {
    color: var(--text);
  }
  .summary.error {
    color: var(--danger-text);
  }
</style>
