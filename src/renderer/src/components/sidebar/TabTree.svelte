<script lang="ts">
  import type { SidebarRow } from "@shared/folders";
  import { api, browser } from "../../lib/browser.svelte";
  import type { TabSelection } from "../../lib/tab-selection.svelte";
  import { treeEntries } from "../../lib/tab-tree";
  import type { TreeDrag } from "../../lib/tree-drag.svelte";
  import SplitGroup from "../split/SplitGroup.svelte";
  import TabItem from "../TabItem.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import FolderLabel from "./FolderLabel.svelte";
  import TreeRow from "./TreeRow.svelte";

  /**
   * The tab tree of the shown space (ADR-022): folders, tabs and splits, with pointer drag and drop
   * (`drag`), Ctrl/Cmd+click selection (`selection`) and keyboard navigation.
   * `onEditFolder(id)`: toggles that folder's edit popover; `onEditFolder(id, true)` opens it.
   */
  let {
    rows,
    drag,
    selection,
    onEditFolder,
  }: { rows: SidebarRow[]; drag: TreeDrag; selection: TabSelection; onEditFolder: (id: string, open?: boolean) => void } = $props();

  const entries = $derived(treeEntries(rows, browser.state.tabs, browser.state.split?.tabIds ?? []));
  const tabList = $derived(drag.list);

  /** The tab list's single Tab stop (roving tabindex): the active tab, else the first one. */
  const focusId = $derived(
    browser.regularTabs.some((item) => item.id === browser.state.activeTabId) ? browser.state.activeTabId : (browser.regularTabs[0]?.id ?? null),
  );

  /** Where the insertion line goes (re-measured when the tabs change). */
  const indicator = $derived.by(() => {
    void browser.state;
    return drag.indicator();
  });

  /** Bring the active tab into view (switching tabs from the palette, a shortcut, a new tab…). */
  $effect(() => {
    const id = browser.state.activeTabId;
    if (!id || !tabList) return;
    queueMicrotask(() => tabList?.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  });

  function onClickCapture(event: MouseEvent): void {
    // Ctrl/Cmd+click adds a tab to the selection (ADR-033) instead of showing it.
    if ((event.ctrlKey || event.metaKey) && !drag.swallowing) {
      const id = (event.target as HTMLElement).closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
      if (id) {
        event.preventDefault();
        event.stopPropagation();
        selection.toggle(id);
      }
      return;
    }
    drag.consumeClick(event);
  }

  /**
   * Keyboard navigation of the tab list (WAI-ARIA tabs pattern, vertical): arrows and Home/End
   * move the focus, Enter/Space activate, Delete/Backspace close the focused tab.
   */
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && selection.ids.length) {
      event.preventDefault();
      selection.clear();
      return;
    }
    const items = [...(tabList?.querySelectorAll<HTMLElement>("[role=tab]") ?? [])];
    const current = items.findIndex((item) => item === document.activeElement);
    if (current === -1) return;
    const id = items[current].dataset.tabId!;
    const focus = (index: number) => {
      const target = items[Math.max(0, Math.min(items.length - 1, index))];
      for (const item of items) item.tabIndex = item === target ? 0 : -1;
      target?.focus();
      target?.scrollIntoView({ block: "nearest" });
    };
    switch (event.key) {
      case "ArrowDown":
        focus(current + 1);
        break;
      case "ArrowUp":
        focus(current - 1);
        break;
      case "Home":
        focus(0);
        break;
      case "End":
        focus(items.length - 1);
        break;
      case "Enter":
      case " ":
        api.tabs.activate(id);
        break;
      case "Delete":
      case "Backspace": {
        // Focus moves to the neighbour that takes the closed tab's place.
        const next = items[current + 1] ?? items[current - 1];
        api.tabs.close(id);
        if (next) {
          const nextId = next.dataset.tabId;
          setTimeout(() => tabList?.querySelector<HTMLElement>(`[data-tab-id="${nextId}"]`)?.focus(), 50);
        }
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }
</script>

<!-- Pointer drag and drop of rows; the keyboard has the tab menu's "Déplacer vers le dossier…". -->
<div
  class="tabs"
  class:dragging={drag.current}
  role="tablist"
  aria-label="Onglets"
  aria-orientation="vertical"
  tabindex="-1"
  bind:this={drag.list}
  onkeydown={onKeydown}
  onpointerdown={drag.pointerDown}
  onclickcapture={onClickCapture}
>
  {#each entries as entry (entry.key)}
    {#if "split" in entry}
      <TreeRow depth={entry.depth} data-row-index={entry.index} data-depth={entry.depth} role="none">
        <SplitGroup tabs={entry.split} {focusId} />
      </TreeRow>
    {:else if "folder" in entry}
      {@const folder = entry.folder.folder}
      <TreeRow
        depth={entry.depth}
        folder
        dropInside={drag.insideRow === entry.index}
        dragged={drag.isDragged("folder", folder.id)}
        data-row-index={entry.index}
        data-depth={entry.depth}
        data-drag-kind="folder"
        data-drag-id={folder.id}
        data-drag-label={folder.name}
        data-folder-id={folder.id}
        role="none"
        oncontextmenu={(event) => (event.preventDefault(), onEditFolder(folder.id, true))}
      >
        <FolderLabel row={entry.folder} onToggle={() => api.folders.update(folder.id, { collapsed: !folder.collapsed })} />
        <IconButton
          size="sm"
          class="more"
          icon="more"
          iconSize={14}
          label={`Modifier le dossier ${folder.name}`}
          title="Modifier le dossier"
          onclick={() => onEditFolder(folder.id)}
        />
      </TreeRow>
    {:else}
      <TreeRow
        depth={entry.depth}
        selected={selection.has(entry.tab.id)}
        dragged={drag.isDragged("tab", entry.tab.id)}
        data-row-index={entry.index}
        data-depth={entry.depth}
        data-drag-kind={entry.tab.isPinned ? undefined : "tab"}
        data-drag-id={entry.tab.id}
        data-drag-label={entry.tab.title}
        role="none"
      >
        <TabItem tab={entry.tab} active={entry.tab.id === browser.state.activeTabId} focusable={entry.tab.id === focusId} />
      </TreeRow>
    {/if}
  {/each}
  {#if indicator}
    <div class="drop-line" style:top="{indicator.top}px" style:--depth={indicator.depth} aria-hidden="true"></div>
  {/if}
</div>

<style>
  /*
   * Rows keep their height and the list scrolls (never squeezes). The 2px padding keeps the
   * active tab's ring and shadow inside the scroll box; the gutter stays reserved so the rows do
   * not shift when the scrollbar appears.
   */
  .tabs {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    margin: 0 -2px;
    padding: 2px;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .tabs > :global(*) {
    flex: none;
  }
  .tabs:focus-visible {
    outline-offset: -2px;
  }
  .tabs.dragging {
    cursor: grabbing;
  }
  /* Insertion indicator: an accent line with a dot, indented to the target's level. */
  .drop-line {
    position: absolute;
    right: 4px;
    left: calc(6px + var(--depth, 0) * var(--indent));
    height: 2px;
    border-radius: 1px;
    background: var(--accent-text);
    pointer-events: none;
  }
  .drop-line::before {
    position: absolute;
    top: -3px;
    left: -4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-text);
    content: "";
  }
</style>
