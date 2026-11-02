<script lang="ts">
  import { WIDGET_CATALOG, type StartWidget } from "@shared/start-widgets";
  import type { Component } from "svelte";
  import Icon from "../Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import type { StartLayout } from "./layout.svelte";
  import WidgetOptions from "./WidgetOptions.svelte";
  import CalendarWidget from "./widgets/CalendarWidget.svelte";
  import ClockWidget from "./widgets/ClockWidget.svelte";
  import DevicesWidget from "./widgets/DevicesWidget.svelte";
  import FavoritesWidget from "./widgets/FavoritesWidget.svelte";
  import NotesWidget from "./widgets/NotesWidget.svelte";
  import ResumeWidget from "./widgets/ResumeWidget.svelte";
  import SearchWidget from "./widgets/SearchWidget.svelte";
  import TodoWidget from "./widgets/TodoWidget.svelte";
  import TopSitesWidget from "./widgets/TopSitesWidget.svelte";
  import WeatherWidget from "./widgets/WeatherWidget.svelte";

  const VIEWS: Record<StartWidget["kind"], Component<{ widget: never; layout: StartLayout; editing: boolean }>> = {
    clock: ClockWidget,
    search: SearchWidget,
    "top-sites": TopSitesWidget,
    favorites: FavoritesWidget,
    devices: DevicesWidget,
    notes: NotesWidget,
    weather: WeatherWidget,
    calendar: CalendarWidget,
    todo: TodoWidget,
    resume: ResumeWidget,
  };
  /** Drawn without a card: the page's heading and its search field. */
  const BARE = new Set<StartWidget["kind"]>(["clock", "search"]);

  /**
   * One widget on the start page. In edit mode the card itself is the handle: drag it, or focus it
   * and use the arrow keys; Delete removes it, Enter opens its options.
   */
  let {
    widget,
    layout,
    editing,
    position,
    total,
    optionsOpen,
    dragging,
    dropTarget,
    onmove,
    ontoggleoptions,
    ondragstart,
    ondragover,
    ondrop,
    ondragend,
  }: {
    widget: StartWidget;
    layout: StartLayout;
    editing: boolean;
    position: number;
    total: number;
    optionsOpen: boolean;
    dragging: boolean;
    dropTarget: boolean;
    onmove: (delta: number) => void;
    ontoggleoptions: () => void;
    ondragstart: () => void;
    ondragover: () => void;
    ondrop: () => void;
    ondragend: () => void;
  } = $props();

  const info = $derived(WIDGET_CATALOG[widget.kind]);
  const View = $derived(VIEWS[widget.kind]);

  function onKeydown(event: KeyboardEvent): void {
    if (!editing || event.target !== event.currentTarget) return;
    const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (delta) {
      event.preventDefault();
      onmove(delta);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      layout.remove(widget.id);
    } else if (event.key === "Enter") {
      event.preventDefault();
      ontoggleoptions();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="widget kind-{widget.kind}"
  class:card={!BARE.has(widget.kind) || editing}
  class:editing
  class:dragging
  class:drop-target={dropTarget}
  role="listitem"
  data-widget-id={widget.id}
  tabindex={editing ? 0 : undefined}
  aria-label={editing ? `${info.label}, position ${position} sur ${total}. Flèches pour déplacer, Entrée pour les options, Suppr pour retirer.` : undefined}
  draggable={editing}
  onkeydown={onKeydown}
  ondragstart={(event) => {
    if (!editing) return;
    event.dataTransfer?.setData("text/plain", widget.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    ondragstart();
  }}
  ondragover={(event) => {
    if (!editing) return;
    event.preventDefault();
    ondragover();
  }}
  ondrop={(event) => {
    if (!editing) return;
    event.preventDefault();
    ondrop();
  }}
  ondragend={ondragend}
>
  {#if editing}
    <div class="chrome">
      <span class="handle"><Icon name="grip-vertical" size={14} /> {info.label}</span>
      <span class="tools">
        <IconButton icon="sliders" size="sm" label="Options de {info.label}" pressed={optionsOpen} onclick={ontoggleoptions} />
        <IconButton icon="close" size="sm" label="Retirer {info.label}" onclick={() => layout.remove(widget.id)} />
      </span>
    </div>
  {/if}
  <div class="content" inert={editing}>
    <View widget={widget as never} {layout} {editing} />
  </div>
  {#if optionsOpen}
    <WidgetOptions {widget} {layout} onclose={ontoggleoptions} />
  {/if}
</div>

<style>
  .widget {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    border-radius: calc(var(--radius-lg) + var(--space-1));
    transition:
      opacity var(--motion-fast) var(--ease),
      box-shadow var(--motion-fast) var(--ease);
  }
  .card {
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--bg-elevated) 82%, transparent);
    backdrop-filter: blur(12px);
  }
  .content {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
    gap: var(--space-2);
  }
  .editing {
    cursor: grab;
  }
  .editing .content {
    opacity: 0.75;
  }
  .editing:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .dragging {
    opacity: 0.4;
  }
  .drop-target {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .chrome {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: calc(-1 * var(--space-1)) calc(-1 * var(--space-1)) var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .handle {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .tools {
    display: flex;
    gap: 2px;
  }
  .widget :global(.widget-title) {
    display: flex;
    align-items: center;
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .widget :global(.widget-empty) {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--text-sm);
  }
</style>
