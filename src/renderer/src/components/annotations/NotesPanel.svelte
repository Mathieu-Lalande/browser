<script lang="ts">
  import { COLOR_LABELS, HIGHLIGHT_SWATCHES, type HighlightColor, type TabAnnotations } from "@shared/annotations/model";
  import type { TabState } from "@shared/types";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import HighlightColors from "./HighlightColors.svelte";

  /**
   * The notes panel next to the page (ADR-037, ADR-010: it narrows the viewport, the page view is
   * native): the page's note, "Surligner" for the selection, its highlights in page order (a click
   * scrolls the page to one and flashes it).
   */
  let { tab, onClose }: { tab: TabState; onClose: () => void } = $props();

  let info = $state<TabAnnotations | null>(null);
  let note = $state("");
  let message = $state<string | null>(null);
  let request = 0;

  async function refresh(): Promise<void> {
    const id = ++request;
    const next = await api.annotations.forTab(tab.id).catch(() => null);
    if (id !== request) return;
    // The note being typed is not overwritten by the echo of its own save.
    if (!info || next?.url !== info.url || document.activeElement?.id !== "page-note") note = next?.note ?? "";
    info = next;
  }

  $effect(() => {
    void tab.id;
    void tab.url;
    void tab.isLoading;
    void refresh();
  });
  $effect(() => api.annotations.onChanged(() => void refresh()));

  function saveNote(): void {
    if (info && note !== info.note) api.annotations.setNote(info.url, note);
  }

  async function highlight(color: HighlightColor): Promise<void> {
    const result = await api.annotations.highlight(tab.id, color).catch(() => ({ ok: false as const, message: "Le surlignage a échoué." }));
    message = result.ok ? null : result.message;
  }
</script>

<aside class="notes" aria-label="Notes de la page" data-testid="notes-panel">
  <header>
    <Icon name="notebook-pen" size={16} />
    <h2>Notes de la page</h2>
    <IconButton size="sm" icon="close" iconSize={14} label="Fermer les notes" command="toggle-notes-panel" onclick={onClose} />
  </header>
  {#if info}
    {#if info.notice}<p class="hint"><Icon name="mask" size={13} /> {info.notice}</p>{/if}
    <label class="field">
      <span class="label">Note</span>
      <textarea id="page-note" class="ui-field" rows="4" bind:value={note} placeholder="Une note sur cette page…" onblur={saveNote}></textarea>
    </label>
    <div class="make">
      <span class="label">Surligner la sélection</span>
      <HighlightColors label="Surligner la sélection en" onpick={highlight} />
    </div>
    {#if message}<p class="hint" role="status">{message}</p>{/if}
    <span class="label">{info.highlights.length ? `${info.highlights.length} surlignage${info.highlights.length > 1 ? "s" : ""}` : "Aucun surlignage"}</span>
    <ul>
      {#each info.highlights as item (item.id)}
        {@const missing = info.missing.includes(item.id)}
        <li style:--swatch={HIGHLIGHT_SWATCHES[item.color].ink}>
          <button class="quote" class:missing disabled={missing} title={missing ? "Introuvable sur la page" : `Aller au passage (${COLOR_LABELS[item.color]})`} onclick={() => api.annotations.jump(tab.id, item.id)}>
            <span class="text">{item.exact}</span>
            {#if item.note}<span class="sub">{item.note}</span>{/if}
            {#if missing}<span class="sub">Introuvable sur la page</span>{/if}
          </button>
          <IconButton size="row" icon="trash" iconSize={13} label="Supprimer le surlignage" onclick={() => api.annotations.remove(item.id)} />
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint">Les notes sont disponibles sur les pages web.</p>
  {/if}
  <button class="all" onclick={() => api.commands.run("open-notes")}><Icon name="notebook" size={14} /> Toutes les notes</button>
</aside>

<style>
  .notes {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-3);
    width: 280px;
    padding: var(--space-3);
    overflow-y: auto;
    border-radius: var(--page-radius, var(--radius-md));
    background: var(--bg-elevated);
    box-shadow: var(--viewport-shadow);
    animation: rise var(--motion-base) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .label {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .field,
  .make {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  textarea {
    height: auto;
    min-height: 72px;
    resize: vertical;
    font: inherit;
  }
  .hint {
    display: flex;
    gap: var(--space-2);
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.4;
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: flex-start;
    gap: var(--space-1);
  }
  .quote {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border-left: 3px solid var(--swatch);
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .quote:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .quote.missing {
    opacity: 0.6;
  }
  .text {
    display: -webkit-box;
    overflow: hidden;
    font-size: var(--text-sm);
    line-height: 1.4;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  .sub {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .all {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: auto;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .all:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  @keyframes rise {
    from {
      opacity: 0;
    }
  }
</style>
