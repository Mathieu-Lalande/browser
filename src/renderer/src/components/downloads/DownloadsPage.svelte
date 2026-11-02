<script lang="ts">
  import Card from "../ui/Card.svelte";
  import { isActiveDownload, type DownloadEntry } from "@shared/downloads";
  import { api } from "../../lib/browser.svelte";
  import { downloads } from "../../lib/downloads.svelte";
  import Button from "../ui/Button.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Page from "../ui/Page.svelte";
  import SearchField from "../ui/SearchField.svelte";
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

<Page icon="download" title="Téléchargements" subtitle="Retirer un téléchargement de la liste ne supprime pas le fichier.">
  {#snippet actions()}
    <Button icon="list-x" disabled={!clearable} onclick={() => api.downloads.clear()}>Effacer la liste</Button>
  {/snippet}

  <SearchField bind:value={query} label="Rechercher dans les téléchargements" />

  {#if groups.length}
    {#each groups as group (group.label)}
      <section aria-label={group.label}>
        <h2>{group.label}</h2>
        <Card as="div">
          {#each group.entries as entry (entry.id)}
            <DownloadRow {entry} showSource />
          {/each}
        </Card>
      </section>
    {/each}
  {:else if downloads.entries.length}
    <EmptyState icon="search" title="Aucun résultat" hint="Aucun téléchargement ne correspond à cette recherche." />
  {:else}
    <EmptyState icon="download" title="Aucun téléchargement pour l'instant" hint="Les fichiers que vous téléchargez apparaîtront ici, classés par jour." />
  {/if}
</Page>

<style>
  h2 {
    margin: var(--space-1) var(--space-1) var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
</style>
