<script lang="ts">
  import { isFavoriteUrl } from "@shared/favorites";
  import type { SpaceId } from "@shared/types";
  import { api, browser } from "../lib/browser.svelte";
  import { settings } from "../lib/settings.svelte";
  import { PEEK_GAP, SpaceSwipeController } from "../lib/space-swipe-controller.svelte";
  import { TabSelection } from "../lib/tab-selection.svelte";
  import { treeRows, type FolderRow } from "../lib/tab-tree";
  import { TreeDrag } from "../lib/tree-drag.svelte";
  import AddressBar from "./AddressBar.svelte";
  import FavoritesGrid from "./folders/FavoritesGrid.svelte";
  import FolderEditor from "./folders/FolderEditor.svelte";
  import Icon from "./Icon.svelte";
  import MiniPlayer from "./media/MiniPlayer.svelte";
  import PanelStrip from "./panels/PanelStrip.svelte";
  import NavButtons from "./sidebar/NavButtons.svelte";
  import ExtensionBar from "./sidebar/ExtensionBar.svelte";
  import SelectionBar from "./sidebar/SelectionBar.svelte";
  import SidebarFooter from "./sidebar/SidebarFooter.svelte";
  import SpaceHeader from "./sidebar/SpaceHeader.svelte";
  import SpacePeek from "./sidebar/SpacePeek.svelte";
  import TabTree from "./sidebar/TabTree.svelte";
  import SpaceEditor from "./spaces/SpaceEditor.svelte";

  let addressBar: AddressBar;
  let sidebarElement = $state<HTMLElement>();
  let spaceArea = $state<HTMLElement>();

  const reduceMotion = $derived(settings.current.appearance.reduceMotion);

  export function focusAddress(): void {
    addressBar.focus();
  }

  /** "Sélectionner tous les onglets": every unpinned tab of the space shown. */
  export function selectAllTabs(): void {
    selection.selectAll();
  }

  /** Opens a space's editor (its name field is focused: renaming is typing). */
  export function editSpace(id: SpaceId): void {
    editing = id;
  }

  /** Space whose edit popover is open. */
  let editing = $state<SpaceId | null>(null);
  const editedSpace = $derived(browser.state.spaces.find((space) => space.id === editing));
  let confirmingNewSpace = $state(false);
  let confirmNewSpaceButton = $state<HTMLButtonElement>();

  // The tab tree (ADR-022), folders and regular tabs, and the folder whose edit popover is open.
  const folders = $derived(browser.state.folders ?? []);
  const rows = $derived(treeRows(browser.state.tabs, folders, browser.state.activeTabId));
  let editingFolder = $state<string | null>(null);
  const editedFolder = $derived(rows.find((row): row is FolderRow => row.kind === "folder" && row.folder.id === editingFolder));

  const drag = new TreeDrag({
    rows: () => rows,
    folders: () => folders,
    canFavorite: (item) => {
      const tab = item.kind === "tab" ? browser.state.tabs.find((candidate) => candidate.id === item.id) : undefined;
      return !browser.isPrivate && !!tab && isFavoriteUrl(tab.url);
    },
    onStart: () => (editingFolder = null),
    // A tab dropped on another one (ADR-045): both side by side, the target shown first.
    onSplit: (tabId, targetId) => {
      api.tabs.activate(targetId);
      api.split.open(tabId);
    },
    onDrop: (item, target) => {
      if ("favorite" in target) api.favorites.add(item.id);
      else if (target.kind === "tab") api.tabs.place(item.id, target.folderId, target.beforeId);
      else api.folders.move(item.id, target.parentId, target.index);
    },
  });

  const selection = new TabSelection();
  // Another space shown: its tabs are not the selected ones.
  $effect(() => {
    void browser.state.activeSpaceId;
    selection.clear();
  });

  // Switching spaces slides the tab list in from the side of the new space; a swipe brings the
  // neighbours beside it (SpaceSwipeController).
  const spaceIndex = $derived(browser.state.spaces.findIndex((space) => space.id === browser.state.activeSpaceId));
  const neighbours = $derived({
    previous: browser.state.spaces[spaceIndex - 1],
    next: browser.state.spaces[spaceIndex + 1],
  });
  const peekOf = (id: SpaceId) => browser.state.peeks?.find((peek) => peek.spaceId === id);
  const swipe = new SpaceSwipeController({
    neighbours: () => neighbours,
    reduceMotion: () => reduceMotion,
    switchTo: (id) => api.spaces.switchTo(id),
    blocked: () => !!drag.current,
    onLift: () => drag.swallowNextClick(),
    atBoundary: (direction) => {
      if (direction < 0) api.overlay.showTabOverview();
      else if (!browser.isPrivate) confirmingNewSpace = true;
    },
  });
  $effect(() => {
    if (confirmingNewSpace) confirmNewSpaceButton?.focus();
  });
  // The switch the release slid to arrived: drop the offset in the same update as the new content.
  $effect.pre(() => swipe.spaceShown(browser.state.activeSpaceId));
  $effect(() => {
    if (sidebarElement) return swipe.attach(sidebarElement, () => spaceArea);
  });

  /** Space changes are immediate: the page must not bounce after a swipe or shortcut. */
  function spaceIn(_node: Element) {
    swipe.takeInstantSwitch();
    return { duration: 0 };
  }

  /** Right click on the sidebar's empty space (not a tab, folder, button or field): its native menu. */
  function onSidebarContextMenu(event: MouseEvent): void {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, a, [data-drag-kind], [data-tab-id], .favorites-area, .footer, .mini-player")) return;
    event.preventDefault();
    api.sidebar.contextMenu();
  }

  function newTab(): void {
    api.tabs.create();
    focusAddress();
  }

  function createConfirmedSpace(): void {
    confirmingNewSpace = false;
    void api.spaces.create();
  }

  function onSidebarKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && confirmingNewSpace) {
      event.preventDefault();
      confirmingNewSpace = false;
    }
  }
</script>

<aside class="sidebar" bind:this={sidebarElement} oncontextmenu={onSidebarContextMenu}>
  <NavButtons />
  <AddressBar bind:this={addressBar} />
  <ExtensionBar />

  <div class="favorites-area" bind:this={drag.favorites}>
    <FavoritesGrid dropping={drag.overFavorites} dragActive={drag.canFavorite} />
  </div>

  <div class="space-area" data-testid="space-area" bind:this={spaceArea}>
    <div
      class="space-track"
      style:--peek-gap="{PEEK_GAP}px"
      style:transform={swipe.offset ? `translate3d(${swipe.offset}px, 0, 0)` : undefined}
    >
      {#if swipe.swiping && neighbours.previous}
        <SpacePeek space={neighbours.previous} peek={peekOf(neighbours.previous.id)} side="previous" />
      {/if}
      {#key browser.state.activeSpaceId}
        <div class="space-content" in:spaceIn>
          <SpaceHeader
            space={browser.state.spaces.length > 1 ? browser.activeSpace : undefined}
            pinned={browser.pinnedTabs}
            activeId={browser.state.activeTabId}
            onEdit={() => (editing = browser.state.activeSpaceId)}
            onNewTab={newTab}
          />
          <SelectionBar {selection} />
          <TabTree
            {rows}
            {drag}
            {selection}
            onEditFolder={(id, open) => (editingFolder = open || editingFolder !== id ? id : null)}
          />
        </div>
      {/key}
      {#if swipe.swiping && neighbours.next}
        <SpacePeek space={neighbours.next} peek={peekOf(neighbours.next.id)} side="next" />
      {/if}
    </div>
  </div>

  {#if confirmingNewSpace}
    <div class="new-space-confirm" role="dialog" aria-label="Créer un espace" tabindex="-1" onkeydown={onSidebarKeydown}>
      <p>Créer un nouvel espace&nbsp;?</p>
      <div class="new-space-actions">
        <button type="button" class="secondary" onclick={() => (confirmingNewSpace = false)}>Annuler</button>
        <button type="button" class="primary" bind:this={confirmNewSpaceButton} onclick={createConfirmedSpace}>Créer</button>
      </div>
    </div>
  {/if}

  {#if editedSpace}
    <SpaceEditor space={editedSpace} onClose={() => (editing = null)} />
  {/if}
  {#if editedFolder && !editedSpace}
    <FolderEditor folder={editedFolder.folder} count={editedFolder.count} onClose={() => (editingFolder = null)} />
  {/if}
  {#if drag.current}
    <div class="drag-ghost" style:left="{drag.current.x + 12}px" style:top="{drag.current.y + 8}px" aria-hidden="true">
      <Icon name={drag.current.item.kind === "folder" ? "folder" : drag.overFavorites ? "favorite" : drag.splitTarget ? "split" : "file"} size={12} />
      <span>{drag.splitTarget ? `Vue scindée : ${drag.current.label}` : drag.current.label}</span>
    </div>
  {/if}
  <PanelStrip />
  <MiniPlayer />
  <SidebarFooter
    onEditSpace={(id) => (editing = editing === id ? null : id)}
    progress={swipe.progress}
    following={swipe.swiping && !swipe.settling}
  />
</aside>

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--sidebar-gap);
    /* Touch: vertical pans scroll (the browser's), horizontal ones swipe between spaces (ours). */
    touch-action: pan-y;
    /* Never more than 45% of the window, whatever the saved width. */
    width: min(var(--sidebar-width), 45vw);
    min-width: 0;
    height: 100%;
    padding: 0 8px 8px;
    /* Narrow-sidebar rules of its parts (title bar, address bar, indentation) query this. */
    container: sidebar / inline-size;
    /* Indentation of the tab tree's levels (TreeRow): narrows with the sidebar. */
    --indent: clamp(8px, 5cqi, 14px);
  }
  .new-space-confirm {
    position: absolute;
    z-index: 20;
    right: 12px;
    bottom: 52px;
    left: 12px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-elevated);
    box-shadow: 0 12px 30px rgb(0 0 0 / 0.25);
  }
  .new-space-confirm p {
    margin: 0 0 10px;
    color: var(--text);
    font-size: 13px;
  }
  .new-space-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .new-space-actions button {
    height: 28px;
    padding: 0 10px;
    border-radius: 7px;
    font-size: 12px;
  }
  .secondary {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .favorites-area {
    position: relative;
  }
  /* No tiles: takes no room (and no gap), even while its floating drop zone shows. */
  .favorites-area:not(:has(.tile, .empty-hint)) {
    height: 0;
    margin-bottom: calc(-1 * var(--sidebar-gap));
  }
  /* One column as wide as the sidebar: a long tab title must ellipsize, never widen (and shift) the area. */
  .space-area {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  /* The shown space and, while swiping, its neighbours one width (plus a gap) to each side. */
  .space-track {
    position: relative;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }
  .space-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
  }
  .drag-ghost {
    position: fixed;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 220px;
    padding: 4px 10px;
    border-radius: 8px;
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 8px 20px -6px rgb(0 0 0 / 0.5);
    color: var(--text);
    font-size: 12px;
    pointer-events: none;
  }
  .drag-ghost span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
