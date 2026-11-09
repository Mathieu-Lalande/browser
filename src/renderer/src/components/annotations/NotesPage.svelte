<script lang="ts">
  import { t } from "@shared/i18n";
  import { annotatedSites, COLOR_LABELS, HIGHLIGHT_SWATCHES, type AnnotationsList, type HighlightColor } from "@shared/annotations/model";
  import type { AnnotationExportFormat } from "@shared/annotations/export";
  import { displayUrl } from "@shared/url";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import ListRow from "../ui/ListRow.svelte";
  import Page from "../ui/Page.svelte";
  import SearchField from "../ui/SearchField.svelte";
  import HighlightColors from "./HighlightColors.svelte";

  /**
   * `browser://notes` (ADR-037): every highlight and page note of the window's book, grouped by
   * site; search, color filters, Markdown/JSON export, deletion. In a private window, the window's
   * own notes (in memory).
   */

  let list = $state<AnnotationsList | null>(null);
  let query = $state("");
  let colors = $state<HighlightColor[]>([]);
  let notice = $state<{ kind: "error" | "success"; text: string } | null>(null);
  let request = 0;

  const sites = $derived(list ? annotatedSites(list, { query, colors }) : []);
  const total = $derived(list ? list.highlights.length + list.notes.length : 0);
  const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

  async function refresh(): Promise<void> {
    const id = ++request;
    const next = await api.annotations.list().catch(() => null);
    if (id === request) list = next;
  }

  $effect(() => {
    void refresh();
    return api.annotations.onChanged(() => void refresh());
  });

  function toggleColor(color: HighlightColor): void {
    colors = colors.includes(color) ? colors.filter((item) => item !== color) : [...colors, color];
  }

  async function exportAs(format: AnnotationExportFormat): Promise<void> {
    const result = await api.annotations.exportAs(format).catch(() => ({ ok: false as const, message: t("notesPage.exportFailed") }));
    if (result) notice = result.ok ? { kind: "success", text: t("notesPage.notesExported") } : { kind: "error", text: result.message };
  }
</script>

<Page
  icon="notebook"
  title={t("notesPage.notesHighlights")}
  subtitle={t("notesPage.highlightedPassagesNotesFrom")}
  testid="notes-page"
>
  {#snippet actions()}
    {#if total}
      <Button variant="secondary" icon="file-down" onclick={() => exportAs("markdown")}>Markdown</Button>
      <Button variant="secondary" icon="file-down" onclick={() => exportAs("json")}>JSON</Button>
    {/if}
  {/snippet}

  {#if list?.notice}
    <p class="notice"><Icon name="mask" size={14} /> <span>{list.notice}</span></p>
  {/if}
  {#if notice}
    <p class="notice {notice.kind}" role={notice.kind === "error" ? "alert" : "status"}>
      <Icon name={notice.kind === "error" ? "warning" : "check"} size={14} />
      <span>{notice.text}</span>
      <IconButton size="row" icon="close" iconSize={12} label={t("notesPage.closeMessage")} onclick={() => (notice = null)} />
    </p>
  {/if}

  {#if total}
    <div class="filters">
      <SearchField bind:value={query} label={t("notesPage.searchNotes")} placeholder={t("notesPage.searchPassageNoteSite")} />
      <HighlightColors selected={colors} label={t("notesPage.filterColor")} onpick={toggleColor} />
    </div>
    {#each sites as site (site.site)}
      <section class="site" aria-label={site.site}>
        <h2><Icon name="globe" size={14} /> {site.site}</h2>
        {#each site.pages as page (page.url)}
          <Card as="ul" aria-label={page.title || displayUrl(page.url)}>
            <ListRow class="page-row">
              <button class="page-link" title={page.url} onclick={() => api.omnibox.open(page.url, "new")}>
                <span class="page-title">{page.title || displayUrl(page.url)}</span>
                <span class="detail">{displayUrl(page.url)}</span>
              </button>
              <ConfirmButton question={t("notesPage.deleteAllNotesPage")} confirmLabel={t("notesPage.delete")} title={t("notesPage.deletePagesNotes")} onconfirm={() => api.annotations.removePage(page.url)}>
                <Icon name="trash" size={14} />
              </ConfirmButton>
            </ListRow>
            {#if page.note}
              <ListRow align="start">
                <Icon name="notebook-pen" size={14} />
                <span class="text note">{page.note.text}</span>
              </ListRow>
            {/if}
            {#each page.highlights as highlight (highlight.id)}
              <ListRow align="start" data-highlight-id={highlight.id}>
                <span class="dot" style:--swatch={HIGHLIGHT_SWATCHES[highlight.color].ink} title={COLOR_LABELS[highlight.color]}></span>
                <span class="text">
                  <span class="quote">{highlight.exact}</span>
                  {#if highlight.note}<span class="note">{highlight.note}</span>{/if}
                  <span class="detail">{dateFormat.format(highlight.createdAt)}</span>
                </span>
                <IconButton size="row" icon="copy-text" iconSize={14} label={t("notesPage.copyPassage")} onclick={() => api.annotations.copy(highlight.id)} />
                <IconButton size="row" icon="trash" iconSize={14} label={t("notesPage.deleteHighlight")} onclick={() => api.annotations.remove(highlight.id)} />
              </ListRow>
            {/each}
          </Card>
        {/each}
      </section>
    {:else}
      <EmptyState icon="search" title={t("notesPage.noResults")} hint={t("notesPage.tryAnotherWordRemove")} compact />
    {/each}
  {:else if list}
    <EmptyState icon="highlighter" title={t("notesPage.noNotesYet")} hint={t("notesPage.selectTextPageThen")} />
  {/if}
</Page>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .filters :global(.search) {
    flex: 1 1 240px;
  }
  .site {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .notice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .notice span {
    flex: 1;
  }
  .notice.error {
    color: var(--danger-text);
  }
  .page-link {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    text-align: left;
  }
  .page-title {
    font-weight: 600;
  }
  .page-link:hover .page-title {
    color: var(--accent-text);
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .quote {
    line-height: 1.45;
  }
  .note {
    color: var(--text-muted);
  }
  .detail {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: var(--space-3);
    height: var(--space-3);
    margin-top: var(--space-1);
    border-radius: 50%;
    background: var(--swatch);
  }
</style>
