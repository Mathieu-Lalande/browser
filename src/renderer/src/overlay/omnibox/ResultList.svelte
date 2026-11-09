<script lang="ts">
  import { t } from "@shared/i18n";
  import Icon from "../../components/Icon.svelte";
  import { dispositionOf, type OmniboxController } from "./controller.svelte";
  import { SECTION_ICONS } from "./icons";
  import ResultRow from "./ResultRow.svelte";

  /** Sectioned results; keyboard selection is flat across sections (`bar.current`). */
  let { bar }: { bar: OmniboxController } = $props();

  let list = $state<HTMLElement>();

  /** Sections with the flat index of their first row. */
  const groups = $derived.by(() => {
    let offset = 0;
    return bar.result.sections.map((section) => {
      const group = { section, offset };
      offset += section.items.length;
      return group;
    });
  });
  /** Only the web search is left: nothing open or known matches. */
  const nothingFound = $derived(bar.text !== "" && bar.result.sections.every((section) => section.id === "web" || section.id === "go"));

  // Keep the selection visible; on the first row, show the first heading too.
  $effect(() => {
    if (bar.current <= 0 && list) list.scrollTop = 0;
    else list?.querySelector(`#omnibox-item-${bar.current}`)?.scrollIntoView({ block: "nearest" });
  });

  /** Last pointer position: the panel appearing (or scrolling) under a still cursor is not a hover. */
  let pointer: { x: number; y: number } | null = null;

  function onPointer(event: MouseEvent, position: number): void {
    const moved = pointer !== null && (pointer.x !== event.screenX || pointer.y !== event.screenY);
    pointer = { x: event.screenX, y: event.screenY };
    if (moved) bar.selected = position;
  }
</script>

<div class="results" id="omnibox-results" role="listbox" aria-label={t("resultList.results")} bind:this={list}>
  {#if nothingFound}
    <p class="empty">{t("resultList.noTabPageAction")}</p>
  {:else if bar.scope && bar.items.length === 0}
    <p class="empty">{t("resultList.nothingShowHereYet")}</p>
  {/if}
  {#each groups as { section, offset } (section.id)}
    <div class="group" role="group" aria-labelledby={section.title ? `omnibox-section-${section.id}` : undefined}>
      {#if section.title}
        <div class="heading" id="omnibox-section-{section.id}">
          <Icon name={SECTION_ICONS[section.id]} size={11} />
          {section.title}
        </div>
      {/if}
      {#each section.items as item, index (item.key)}
        {@const position = offset + index}
        <ResultRow
          {item}
          {position}
          selected={position === bar.current}
          onpointer={(event) => onPointer(event, position)}
          onpick={(event) => bar.perform(item, dispositionOf(event))}
        />
      {/each}
    </div>
  {/each}
</div>

<style>
  .results {
    flex: 1;
    min-height: 0;
    padding: 6px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-color: var(--surface-active) transparent;
    scrollbar-width: thin;
  }
  .group + .group {
    margin-top: 4px;
  }
  .heading {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 4px;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .empty {
    margin: 0;
    padding: 18px 12px 10px;
    color: var(--text-faint);
    text-align: center;
  }
</style>
