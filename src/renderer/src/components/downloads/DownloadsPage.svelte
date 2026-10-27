<script lang="ts">
  import { isActiveDownload, type DownloadEntry } from "@shared/downloads";
  import { api } from "../../lib/browser.svelte";
  import { downloads } from "../../lib/downloads.svelte";
  import Icon from "../Icon.svelte";
  import DownloadRow from "./DownloadRow.svelte";

  /** `browser://downloads`: the whole history, searchable, grouped by day. */

  let query = $state("");

  const matches = $derived.by(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return downloads.entries;
    return downloads.entries.filter((entry) => {
      const haystack = `${entry.filename} ${entry.url}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  });
  const clearable = $derived(downloads.entries.some((entry) => !isActiveDownload(entry) && !entry.awaitingConfirmation));

  const dayFormat = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  function dayLabel(time: number): string {
    const day = new Date(time).toDateString();
    const today = new Date();
    if (day === today.toDateString()) return "Aujourd'hui";
    if (day === new Date(today.getTime() - 86_400_000).toDateString()) return "Hier";
    const label = dayFormat.format(time);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  const groups = $derived.by(() => {
    const result: { label: string; entries: DownloadEntry[] }[] = [];
    for (const entry of matches) {
      const label = dayLabel(entry.startedAt);
      if (result.at(-1)?.label === label) result.at(-1)!.entries.push(entry);
      else result.push({ label, entries: [entry] });
    }
    return result;
  });
</script>

<div class="page">
  <div class="inner">
    <header>
      <span class="badge"><Icon name="download" size={20} /></span>
      <h1>Téléchargements</h1>
      <button class="clear" disabled={!clearable} onclick={() => api.downloads.clear()}>
        <Icon name="trash" size={12} /> Effacer la liste
      </button>
    </header>

    <label class="search">
      <Icon name="search" size={16} />
      <input bind:value={query} placeholder="Rechercher dans les téléchargements" aria-label="Rechercher dans les téléchargements" spellcheck="false" />
    </label>

    {#if groups.length}
      {#each groups as group (group.label)}
        <section aria-label={group.label}>
          <h2>{group.label}</h2>
          <div class="card">
            {#each group.entries as entry (entry.id)}
              <DownloadRow {entry} showSource />
            {/each}
          </div>
        </section>
      {/each}
    {:else}
      <p class="empty">
        {downloads.entries.length ? "Aucun téléchargement ne correspond à cette recherche." : "Aucun téléchargement pour l'instant."}
      </p>
    {/if}
    <p class="note">Retirer un téléchargement de la liste ne supprime pas le fichier.</p>
  </div>
</div>

<style>
  .page {
    height: 100%;
    overflow-y: auto;
    animation: rise 0.3s var(--ease);
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 760px;
    margin: 0 auto;
    padding: 36px 32px 64px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 11px;
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--accent-text);
  }
  h1 {
    flex: 1;
    margin: 0;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.03em;
  }
  .clear {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  .clear:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .clear:disabled {
    opacity: 0.45;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 38px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text-faint);
  }
  .search:focus-within {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    user-select: text;
  }
  input::placeholder {
    color: var(--text-faint);
  }
  h2 {
    margin: 6px 4px 8px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 2px);
    background: var(--bg-elevated);
  }
  .empty,
  .note {
    margin: 0;
    color: var(--text-muted);
    text-align: center;
  }
  .empty {
    padding: 48px 0 8px;
  }
  .note {
    color: var(--text-faint);
    font-size: 11.5px;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
