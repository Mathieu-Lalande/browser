<script lang="ts">
  import Card from "../ui/Card.svelte";
  import type { Snippet } from "svelte";
  import Icon, { type IconName } from "../Icon.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import { getRowFilter, setRowFilter } from "../ui/filter";

  let {
    id,
    icon,
    title,
    description,
    keywords = "",
    onReset,
    children,
  }: { id: string; icon: IconName; title: string; description: string; keywords?: string; onReset?: () => void; children: Snippet } = $props();

  // Settings search: a section whose own title or keywords match shows all its rows; otherwise
  // each row filters itself, and the section (CSS below) hides when none is left.
  const page = getRowFilter();
  const matched = $derived(!!page?.active && page.matches(`${title} ${description} ${keywords}`));
  setRowFilter({
    get active() {
      return !!page?.active && !matched;
    },
    matches: (text) => page?.matches(text) ?? true,
  });
</script>

<section class="section" {id} aria-labelledby="{id}-title" data-section={id} data-searching={page?.active || undefined} data-match={matched || undefined}>
  <header>
    <span class="badge"><Icon name={icon} size={16} /></span>
    <div class="heading">
      <h2 id="{id}-title">{title}</h2>
      <p>{description}</p>
    </div>
    {#if onReset}
      <ConfirmButton
        question="Réglages par défaut ?"
        confirmLabel="Réinitialiser"
        title="Revenir aux réglages par défaut de cette section"
        onconfirm={onReset}
      >
        <Icon name="reset" size={12} /> Réinitialiser
      </ConfirmButton>
    {/if}
  </header>
  <Card as="div" variant="section">
    {@render children()}
  </Card>
</section>

<style>
  .section {
    scroll-margin-top: 24px;
  }
  /* Searching: only matching rows; the other blocks of the section, and a section left empty, hide. */
  .section[data-searching]:not([data-match]) :global(.card.section > :not([data-row])) {
    display: none;
  }
  .section[data-searching]:not([data-match]):not(:has([data-row]:not([data-hidden]))) {
    display: none;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0 var(--space-1) var(--space-3);
  }
  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: linear-gradient(135deg, color-mix(in oklab, var(--accent) 24%, transparent), color-mix(in oklab, var(--accent-2) 14%, transparent));
    color: var(--accent-text);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 22%, transparent);
  }
  .heading {
    flex: 1 1 200px;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  p {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.45;
  }
</style>
