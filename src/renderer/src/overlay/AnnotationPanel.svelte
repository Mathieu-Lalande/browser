<script lang="ts">
  import type { Highlight, HighlightColor } from "@shared/annotations/model";
  import type { Bounds } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import HighlightColors from "../components/annotations/HighlightColors.svelte";
  import Button from "../components/ui/Button.svelte";
  import Icon from "../components/Icon.svelte";

  /**
   * The popover of a highlight clicked in the page (ADR-037): its color, its note, copy the quote,
   * delete. Main keeps the highlight; this only names it by id.
   */
  let { anchor, annotationId, onClose }: { anchor?: Bounds; annotationId: string; onClose: (restoreFocus: boolean) => void } = $props();

  const WIDTH = 320;
  const MARGIN = 8;

  let panel = $state<HTMLElement>();
  let innerWidth = $state(window.innerWidth);
  let innerHeight = $state(window.innerHeight);
  let highlight = $state<Highlight | null>(null);
  let loaded = $state(false);
  let note = $state("");
  let copied = $state(false);

  const position = $derived.by(() => {
    const box = anchor ?? { x: MARGIN, y: MARGIN, width: 0, height: 0 };
    const below = box.y + box.height + 6;
    // Above the highlight when there is no room below it.
    const top = below + 220 > innerHeight && box.y > 240 ? Math.max(MARGIN, box.y - 226) : Math.max(MARGIN, below);
    const left = Math.max(MARGIN, Math.min(box.x, innerWidth - WIDTH - MARGIN));
    return { left, top, maxHeight: Math.max(160, innerHeight - top - MARGIN) };
  });

  $effect(() => {
    void api.annotations
      .get(annotationId)
      .then((found) => {
        highlight = found;
        note = found?.note ?? "";
      }, () => null)
      .finally(() => (loaded = true));
  });
  $effect(() => panel?.focus());

  async function setColor(color: HighlightColor): Promise<void> {
    highlight = (await api.annotations.update(annotationId, { color }).catch(() => null)) ?? highlight;
  }

  async function saveNote(): Promise<void> {
    if (highlight && note !== highlight.note) highlight = (await api.annotations.update(annotationId, { note }).catch(() => null)) ?? highlight;
  }

  async function done(): Promise<void> {
    await saveNote();
    onClose(false);
  }

  function copy(): void {
    api.annotations.copy(annotationId);
    copied = true;
    setTimeout(() => (copied = false), 1400);
  }

  function remove(): void {
    api.annotations.remove(annotationId);
    onClose(false);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      void saveNote().then(() => onClose(true));
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void done();
    }
  }
</script>

<svelte:window bind:innerWidth bind:innerHeight onkeydown={onKeydown} />

<div
  bind:this={panel}
  class="panel"
  role="dialog"
  aria-label="Surlignage"
  tabindex="-1"
  data-testid="annotation-panel"
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:max-height="{position.maxHeight}px"
  style:width="{Math.min(WIDTH, innerWidth - 2 * MARGIN)}px"
>
  {#if highlight}
    <blockquote>{highlight.exact}</blockquote>
    <HighlightColors value={highlight.color} label="Couleur du surlignage" onpick={setColor} />
    <textarea class="ui-field" bind:value={note} rows="3" placeholder="Ajouter une note…" aria-label="Note du surlignage" onblur={saveNote}></textarea>
    <div class="actions">
      <Button size="sm" variant="ghost" icon={copied ? "check" : "copy-text"} onclick={copy}>{copied ? "Copié" : "Copier"}</Button>
      <Button size="sm" variant="danger" icon="trash" onclick={remove}>Supprimer</Button>
      <span class="spacer"></span>
      <Button size="sm" variant="primary" onclick={done}>Terminé</Button>
    </div>
  {:else if loaded}
    <p class="hint"><Icon name="info" size={14} /> Ce surlignage n'existe plus.</p>
  {/if}
</div>

<style>
  .panel {
    position: fixed;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    overflow: auto;
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55),
      0 4px 14px -6px rgb(0 0 0 / 0.35);
    outline: none;
    animation: pop var(--motion-fast) var(--ease);
    transform-origin: top left;
  }
  blockquote {
    display: -webkit-box;
    margin: 0;
    padding-left: var(--space-3);
    overflow: hidden;
    border-left: 3px solid var(--accent);
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: 1.45;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
  }
  textarea {
    height: auto;
    min-height: 72px;
    resize: vertical;
    font: inherit;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .spacer {
    flex: 1;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
</style>
