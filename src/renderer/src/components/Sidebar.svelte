<script lang="ts">
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";
  import { dropZone, resolveDrop, sidebarRows, type DragItem, type DropResult, type SidebarRow } from "@shared/folders";
  import { isFavoriteUrl } from "@shared/favorites";
  import { SpaceSwipe, type SwipeOutput } from "@shared/space-swipe";
  import type { SpaceId, SpaceInfo, SpacePeek, TabState } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../lib/browser.svelte";
  import AddressBar from "./AddressBar.svelte";
  import DownloadsButton from "./downloads/DownloadsButton.svelte";
  import ToolsMenu from "./ToolsMenu.svelte";
  import { settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";
  import { platform } from "../lib/platform.svelte";
  import TabIcon from "./TabIcon.svelte";
  import TabItem from "./TabItem.svelte";
  import WindowControls from "./WindowControls.svelte";
  import SpaceEditor from "./spaces/SpaceEditor.svelte";
  import SpaceSwitcher from "./spaces/SpaceSwitcher.svelte";
  import SplitGroup from "./split/SplitGroup.svelte";
  import FavoritesGrid from "./folders/FavoritesGrid.svelte";
  import FolderEditor from "./folders/FolderEditor.svelte";

  /**
   * `windowControls`: draw the window buttons in the title bar (Windows/Linux, see App): at its
   * start with the sidebar on the left, at its end (the window's right edge) with it on the right.
   */
  let { onToggle, windowControls = false }: { onToggle: () => void; windowControls?: boolean } = $props();
  let addressBar: AddressBar;
  let tabList = $state<HTMLElement>();

  const tab = $derived(browser.activeTab);
  // macOS traffic lights sit at the window's top-left: only a left sidebar makes room for them.
  const controlsAtEnd = $derived(settings.current.layout.sidebarPosition === "right");
  const roomForTrafficLights = $derived(platform.isMac && settings.current.layout.sidebarPosition === "left");
  const zen = $derived(settings.current.layout.zenMode);

  export function focusAddress(): void {
    addressBar.focus();
  }

  /** Space whose edit popover is open. */
  let editing = $state<SpaceId | null>(null);
  const editedSpace = $derived(browser.state.spaces.find((space) => space.id === editing));

  // Switching spaces slides the tab list in from the side of the new space.
  const spaceIndex = $derived(browser.state.spaces.findIndex((space) => space.id === browser.state.activeSpaceId));
  let previousIndex = -1;
  let direction = $state(1);
  $effect.pre(() => {
    const index = spaceIndex;
    direction = index >= previousIndex ? 1 : -1;
    previousIndex = index;
  });

  /**
   * The tab tree (ADR-022): folders and regular tabs, depth first (in each container: sub-folders,
   * then tabs). The tabs of a split are gathered in one entry (in pane order) at the place of its first tab.
   */
  const folders = $derived(browser.state.folders ?? []);
  const rows = $derived(
    sidebarRows(
      browser.state.tabs.map((item) => ({ id: item.id, pinned: item.isPinned, folderId: item.folderId ?? null })),
      folders,
      browser.state.activeTabId,
    ),
  );
  type Entry =
    | { key: string; index: number; depth: number; tab: TabState }
    | { key: string; index: number; depth: number; split: TabState[] }
    | { key: string; index: number; depth: number; folder: Extract<SidebarRow, { kind: "folder" }> };
  const entries = $derived.by((): Entry[] => {
    const splitIds = browser.state.split?.tabIds ?? [];
    const members = splitIds.map((id) => browser.regularTabs.find((item) => item.id === id)).filter((item) => item !== undefined);
    const list: Entry[] = [];
    let placed = false;
    rows.forEach((row, index) => {
      if (row.kind === "folder") {
        list.push({ key: `folder-${row.folder.id}`, index, depth: row.depth, folder: row });
        return;
      }
      const item = browser.state.tabs.find((candidate) => candidate.id === row.id);
      if (!item) return;
      if (!splitIds.includes(item.id) || members.length < 2) list.push({ key: item.id, index, depth: row.depth, tab: item });
      else if (!placed) {
        placed = true;
        list.push({ key: `split-${members[0].id}`, index, depth: row.depth, split: members });
      }
    });
    return list;
  });

  /** Folder whose edit popover is open. */
  let editingFolder = $state<string | null>(null);
  const editedFolder = $derived(rows.find((row) => row.kind === "folder" && row.folder.id === editingFolder) as Extract<SidebarRow, { kind: "folder" }> | undefined);

  // --- Drag and drop (pointer events): tabs and folders in the tree, tabs onto the favorites ----

  /** Pixels the pointer must travel before a press becomes a drag. */
  const DRAG_THRESHOLD = 5;
  let press: { x: number; y: number; item: DragItem; pointerId: number; label: string } | null = null;
  let drag = $state<{ item: DragItem; label: string; x: number; y: number } | null>(null);
  let drop = $state<DropResult | null>(null);
  let overFavorites = $state(false);
  let favoritesArea = $state<HTMLElement>();
  /** The click that ends a drag must not activate the row under the pointer. */
  let swallowClick = false;

  const draggedTab = $derived(drag?.item.kind === "tab" ? browser.state.tabs.find((item) => item.id === drag!.item.id) : undefined);
  const canFavorite = $derived(!browser.isPrivate && !!draggedTab && isFavoriteUrl(draggedTab.url));

  function onRowPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || drag) return;
    const target = event.target as HTMLElement;
    // Buttons inside a row (close, mute, chevron, more) keep their own click.
    if (target.closest("button, input")) return;
    const row = target.closest<HTMLElement>("[data-drag-kind]");
    if (!row) return;
    const kind = row.dataset.dragKind as DragItem["kind"];
    press = { x: event.clientX, y: event.clientY, item: { kind, id: row.dataset.dragId! }, pointerId: event.pointerId, label: row.dataset.dragLabel ?? "" };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", cancelDrag);
    window.addEventListener("keydown", onDragKey, true);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!press || event.pointerId !== press.pointerId) return;
    if (!drag) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD) return;
      drag = { item: press.item, label: press.label, x: event.clientX, y: event.clientY };
      editingFolder = null;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    const grid = favoritesArea?.querySelector<HTMLElement>("[data-drop=favorites]")?.getBoundingClientRect();
    overFavorites = canFavorite && !!grid && event.clientY >= grid.top - 4 && event.clientY <= grid.bottom + 4 && event.clientX >= grid.left && event.clientX <= grid.right;
    drop = overFavorites ? null : dropAt(event.clientY);
    autoScroll(event.clientY);
  }

  /** The drop under a vertical position of the tree. */
  function dropAt(y: number): DropResult | null {
    if (!drag || !tabList) return null;
    const elements = [...tabList.querySelectorAll<HTMLElement>("[data-row-index]")];
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (y < rect.top || y > rect.bottom) continue;
      const index = Number(element.dataset.rowIndex);
      const row = rows[index];
      if (!row) return null;
      const zone = dropZone(row, (y - rect.top) / Math.max(1, rect.height), drag.item.kind);
      return resolveDrop(rows, folders, drag.item, index, zone);
    }
    const last = elements.at(-1)?.getBoundingClientRect();
    if (last && y > last.bottom) return resolveDrop(rows, folders, drag.item, rows.length, "after");
    const first = elements[0]?.getBoundingClientRect();
    if (first && y < first.top && y > first.top - 24) return resolveDrop(rows, folders, drag.item, 0, "before");
    return null;
  }

  function autoScroll(y: number): void {
    if (!tabList) return;
    const rect = tabList.getBoundingClientRect();
    if (y < rect.top + 24) tabList.scrollTop -= 8;
    else if (y > rect.bottom - 24) tabList.scrollTop += 8;
  }

  function onPointerUp(event: PointerEvent): void {
    if (press && event.pointerId !== press.pointerId) return;
    if (drag) {
      swallowClick = true;
      setTimeout(() => (swallowClick = false), 0);
      const { item } = drag;
      if (overFavorites && item.kind === "tab") api.favorites.add(item.id);
      else if (drop?.kind === "tab") api.tabs.place(item.id, drop.folderId, drop.beforeId);
      else if (drop?.kind === "folder") api.folders.move(item.id, drop.parentId, drop.index);
    }
    cancelDrag();
  }

  function onDragKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !drag) return;
    event.preventDefault();
    event.stopPropagation();
    cancelDrag();
  }

  function cancelDrag(): void {
    press = null;
    drag = null;
    drop = null;
    overFavorites = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", cancelDrag);
    window.removeEventListener("keydown", onDragKey, true);
  }

  function onTreeClickCapture(event: MouseEvent): void {
    if (!swallowClick) return;
    event.preventDefault();
    event.stopPropagation();
    swallowClick = false;
  }

  /** Where the insertion line goes, relative to the tree's content. */
  const indicator = $derived.by(() => {
    if (!drop || !tabList || drop.indicator.edge === "inside") return null;
    void browser.state;
    const element = tabList.querySelector<HTMLElement>(`[data-row-index="${drop.indicator.row}"]`);
    if (!element) return null;
    const depth = Number(element.dataset.depth ?? 0) + (drop.kind === "folder" && drop.indicator.edge === "after" && rows[drop.indicator.row]?.kind === "folder" && drop.parentId === (rows[drop.indicator.row] as Extract<SidebarRow, { kind: "folder" }>).folder.id ? 1 : 0);
    const top = element.offsetTop + (drop.indicator.edge === "after" ? element.offsetHeight + 1 : -1);
    return { top, depth };
  });
  const insideRow = $derived(drop?.indicator.edge === "inside" ? drop.indicator.row : -1);

  // --- Two-finger swipe between spaces (ADR-022, logic in @shared/space-swipe) -----------------
  //
  // The tab area is a horizontal track: the shown space, with its neighbours (`peeks`, sent by
  // main) laid beside it while a swipe is on. The track follows the fingers; on release it slides to
  // the snapped position (SETTLE_MS), and only then is the space switched, without the switch's
  // own slide: the neighbour already sits where the new content appears, so nothing jumps.

  /** Room between the shown space and its neighbours on the track, px. */
  const PEEK_GAP = 16;
  const SETTLE_MS = 220;
  let sidebarElement = $state<HTMLElement>();
  let spaceArea = $state<HTMLElement>();
  let swipeOffset = $state(0);
  /** The track animates (release), instead of following the fingers. */
  let settling = $state(false);
  /** The neighbours are drawn (from the first tracked event until the track is back at rest). */
  let swiping = $state(false);
  /** Space the release slid to, switched in main: its state arrives next. */
  let switchingTo: SpaceId | null = null;
  /** The next space switch replaces the content in place (no slide of its own). */
  let instantSwitch = false;
  const reduceMotion = $derived(settings.current.appearance.reduceMotion);
  const neighbours = $derived({
    previous: browser.state.spaces[spaceIndex - 1],
    next: browser.state.spaces[spaceIndex + 1],
  });
  const peekOf = (id: SpaceId | undefined) => browser.state.peeks?.find((peek) => peek.spaceId === id);
  /** Share of the way to a neighbour (+1 next, -1 previous): the space chips' indicator follows. */
  let trackWidth = $state(1);
  const swipeProgress = $derived.by(() => {
    const progress = -swipeOffset / (trackWidth + PEEK_GAP);
    if ((progress > 0 && !neighbours.next) || (progress < 0 && !neighbours.previous)) return 0;
    return Math.max(-1, Math.min(1, progress));
  });

  // The switch the release slid to arrived: drop the offset in the same update as the new content.
  $effect.pre(() => {
    const id = browser.state.activeSpaceId;
    if (switchingTo !== null && id === switchingTo) {
      switchingTo = null;
      instantSwitch = true;
      settling = false;
      swiping = false;
      swipeOffset = 0;
    }
  });

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  function settleTo(offset: number, then: () => void): void {
    clearTimeout(settleTimer);
    settling = true;
    swipeOffset = offset;
    settleTimer = setTimeout(then, reduceMotion ? 0 : SETTLE_MS);
  }

  function snapBack(): void {
    settleTo(0, () => {
      settling = false;
      swiping = false;
    });
  }

  function commitSwipe(direction: 1 | -1): void {
    const target = direction === 1 ? neighbours.next : neighbours.previous;
    if (!target) return snapBack();
    if (reduceMotion) {
      // No motion: the content is replaced in place.
      swiping = false;
      swipeOffset = 0;
      instantSwitch = true;
      api.spaces.switchTo(target.id);
      return;
    }
    settleTo(-direction * (trackWidth + PEEK_GAP), () => {
      switchingTo = target.id;
      api.spaces.switchTo(target.id);
      // Refused or lost: back to rest rather than stuck half-way.
      settleTimer = setTimeout(() => {
        if (switchingTo === target.id) {
          switchingTo = null;
          snapBack();
        }
      }, 600);
    });
  }

  $effect(() => {
    const element = sidebarElement;
    if (!element) return;
    const swipe = new SpaceSwipe({ width: spaceArea?.clientWidth ?? element.clientWidth });
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    const bounds = () => ({ previous: !!neighbours.previous, next: !!neighbours.next });
    const apply = (output: SwipeOutput) => {
      if (output.kind === "track") {
        settling = false;
        clearTimeout(settleTimer);
        if (reduceMotion) return;
        swiping = true;
        swipeOffset = output.offset;
      } else if (output.kind === "commit") commitSwipe(output.direction);
      else if (output.kind === "cancel") snapBack();
    };
    const onWheel = (event: WheelEvent) => {
      // A popover (space or folder editor) scrolls on its own; a drag owns the pointer.
      if (drag || (event.target as HTMLElement).closest?.("[role=dialog]")) return;
      // Sliding to a space: the rest of that gesture changes nothing.
      if (settling && swipeOffset !== 0) {
        if (swipe.active || Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault();
        return;
      }
      trackWidth = spaceArea?.clientWidth || element.clientWidth;
      swipe.setWidth(trackWidth);
      const output = swipe.wheel(
        { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, time: event.timeStamp },
        bounds(),
      );
      clearTimeout(endTimer);
      endTimer = setTimeout(() => apply(swipe.end(performance.now(), bounds())), swipe.endGapMs + 10);
      if (output.kind === "ignore") return;
      event.preventDefault();
      apply(output);
    };
    // Capture: a swipe that starts over the tab list (or any scrolling child) is seen first.
    element.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      clearTimeout(endTimer);
      clearTimeout(settleTimer);
      element.removeEventListener("wheel", onWheel, { capture: true });
    };
  });

  /** The space content's entrance: one slide for a click or shortcut, none after a swipe. */
  function spaceIn(node: Element) {
    if (instantSwitch) {
      instantSwitch = false;
      return { duration: 0 };
    }
    return fly(node, { x: direction * 36, duration: reduceMotion ? 0 : 240, easing: cubicOut, opacity: 0 });
  }

  /** A neighbour space's rows, as its own sidebar would list them (folders, then loose tabs). */
  type PeekRow = { key: string; depth: number; tab: TabState } | { key: string; depth: number; folder: Extract<SidebarRow, { kind: "folder" }> };
  function peekRows(peek: SpacePeek): PeekRow[] {
    const tree = sidebarRows(
      peek.tabs.map((item) => ({ id: item.id, pinned: item.isPinned, folderId: item.folderId ?? null })),
      peek.folders ?? [],
      peek.activeTabId,
    );
    return tree.flatMap((row): PeekRow[] => {
      if (row.kind === "folder") return [{ key: `folder-${row.folder.id}`, depth: row.depth, folder: row }];
      const item = peek.tabs.find((candidate) => candidate.id === row.id);
      return item ? [{ key: item.id, depth: row.depth, tab: item }] : [];
    });
  }

  /** The tab list's single Tab stop (roving tabindex): the active tab, else the first one. */
  const focusId = $derived(
    browser.regularTabs.some((item) => item.id === browser.state.activeTabId) ? browser.state.activeTabId : (browser.regularTabs[0]?.id ?? null),
  );

  /** Bring the active tab into view (switching tabs from the palette, a shortcut, a new tab…). */
  $effect(() => {
    const id = browser.state.activeTabId;
    if (!id || !tabList) return;
    queueMicrotask(() => tabList?.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  });

  /**
   * Keyboard navigation of the tab list (WAI-ARIA tabs pattern, vertical): arrows and Home/End
   * move the focus, Enter/Space activate, Delete/Backspace close the focused tab.
   */
  function onTabsKeydown(event: KeyboardEvent): void {
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

  function newTab(): void {
    api.tabs.create();
    focusAddress();
  }
</script>

<aside class="sidebar" bind:this={sidebarElement}>
  <header class="titlebar drag" class:mac={roomForTrafficLights}>
    {#if windowControls && !controlsAtEnd}<WindowControls />{/if}
    <!-- The flexible part: it gives way (the badge folds to its icon), never the buttons. -->
    <div class="title-slot">
      {#if browser.isPrivate}
        <div class="private-badge" title="Navigation privée : ni historique, ni cookies conservés après la fermeture de la fenêtre">
          <Icon name="mask" size={16} />
          <span class="private-label">Navigation privée</span>
        </div>
      {/if}
    </div>
    <button
      class="icon no-drag"
      class:on={zen}
      aria-label="Mode zen"
      aria-pressed={zen}
      title={platform.tip("Mode zen", "toggle-zen")}
      onclick={() => settings.update({ layout: { zenMode: !zen } })}
    >
      <Icon name="zen" />
    </button>
    <button class="icon no-drag" aria-label="Masquer la barre latérale" title={platform.tip("Masquer la barre latérale", "toggle-sidebar")} onclick={onToggle}>
      <Icon name="sidebar" />
    </button>
    {#if windowControls && controlsAtEnd}<WindowControls />{/if}
  </header>

  <nav class="nav">
    <button class="icon" aria-label="Précédent" title={platform.tip("Précédent", "back")} disabled={!tab?.canGoBack} onclick={() => tab && api.tabs.back(tab.id)}>
      <Icon name="back" />
    </button>
    <button class="icon" aria-label="Suivant" title={platform.tip("Suivant", "forward")} disabled={!tab?.canGoForward} onclick={() => tab && api.tabs.forward(tab.id)}>
      <Icon name="forward" />
    </button>
    {#if tab?.isLoading}
      <button class="icon" aria-label="Arrêter" title="Arrêter le chargement" onclick={() => tab && api.tabs.stop(tab.id)}><Icon name="stop" /></button>
    {:else}
      <button class="icon" aria-label="Actualiser" title={platform.tip("Actualiser", "reload")} disabled={!tab?.url} onclick={() => tab && api.tabs.reload(tab.id)}>
        <Icon name="reload" />
      </button>
    {/if}
    <div class="spacer"></div>
    <button
      class="icon"
      class:on={browser.splitTabs.length > 1}
      aria-label={browser.splitTabs.length > 1 ? "Quitter la vue scindée" : "Vue scindée"}
      title={platform.tip(browser.splitTabs.length > 1 ? "Quitter la vue scindée" : "Vue scindée : afficher deux onglets côte à côte", "toggle-split")}
      onclick={() => api.commands.run("toggle-split")}
    >
      <Icon name="split" />
    </button>
    <button
      class="icon"
      aria-label="Palette de commandes"
      title={platform.tip("Palette de commandes : onglets, pages et actions", "command-palette")}
      onclick={() => api.commands.run("command-palette")}
    >
      <Icon name="command" />
    </button>
  </nav>

  <AddressBar bind:this={addressBar} />

  <div class="favorites-area" bind:this={favoritesArea}>
    <FavoritesGrid dropping={overFavorites} dragActive={canFavorite} />
  </div>

  <div class="space-area" data-testid="space-area" bind:this={spaceArea}>
    <div
      class="space-track"
      class:settling
      style:--settle="{SETTLE_MS}ms"
      style:--peek-gap="{PEEK_GAP}px"
      style:transform={swipeOffset ? `translate3d(${swipeOffset}px, 0, 0)` : undefined}
    >
    {#if swiping && neighbours.previous}{@render peekView(neighbours.previous, peekOf(neighbours.previous.id), "previous")}{/if}
    {#key browser.state.activeSpaceId}
      <div class="space-content" in:spaceIn>
        {#if browser.activeSpace && browser.state.spaces.length > 1}
          <div class="space-title" style:--dot={browser.activeSpace.color ?? "var(--accent)"}>
            <span class="space-icon"><Icon name={browser.activeSpace.icon} size={16} /></span>
            <span class="space-name">{browser.activeSpace.name}</span>
            {#if browser.activeSpace.isolated}<span class="badge" title="Cookies et connexions séparés">Isolé</span>{/if}
            <button class="icon small" aria-label="Modifier l'espace" title="Modifier l'espace" onclick={() => (editing = browser.state.activeSpaceId)}>
              <Icon name="more" />
            </button>
          </div>
        {/if}

        {#if browser.pinnedTabs.length}
          <div class="pinned" role="tablist" aria-label="Onglets épinglés">
            {#each browser.pinnedTabs as pinned (pinned.id)}
              <button
                class="pinned-tab"
                class:active={pinned.id === browser.state.activeTabId}
                class:asleep={pinned.isAsleep}
                role="tab"
                aria-selected={pinned.id === browser.state.activeTabId}
                title={pinned.url && pinned.url !== pinned.title ? `${pinned.title}\n${displayUrl(pinned.url)}` : pinned.title}
                onclick={() => api.tabs.activate(pinned.id)}
                ondblclick={() => api.tabs.togglePin(pinned.id)}
                oncontextmenu={(event) => (event.preventDefault(), api.tabs.contextMenu(pinned.id))}
              >
                <TabIcon tab={pinned} />
              </button>
            {/each}
          </div>
        {/if}

        <div class="divider"></div>

        <div class="new-row">
          <button class="new-tab" title={platform.tip("Nouvel onglet", "new-tab")} onclick={newTab}>
            <Icon name="plus" size={16} /> <span class="label">Nouvel onglet</span>
          </button>
          <button class="icon small" aria-label="Nouveau dossier" title="Nouveau dossier" onclick={() => api.folders.create()}>
            <Icon name="folder-plus" />
          </button>
        </div>

        <!-- Pointer drag and drop of rows; the keyboard has the tab menu's "Déplacer vers le dossier…". -->
        <div
          class="tabs"
          class:dragging={drag}
          role="tablist"
          aria-label="Onglets"
          aria-orientation="vertical"
          tabindex="-1"
          bind:this={tabList}
          onkeydown={onTabsKeydown}
          onpointerdown={onRowPointerDown}
          onclickcapture={onTreeClickCapture}
        >
          {#each entries as entry (entry.key)}
            {#if "split" in entry}
              <div class="row" data-row-index={entry.index} data-depth={entry.depth} style:--depth={entry.depth} role="none">
                <SplitGroup tabs={entry.split} {focusId} />
              </div>
            {:else if "folder" in entry}
              {@const folder = entry.folder.folder}
              <div
                class="row folder-row"
                class:drop-inside={insideRow === entry.index}
                class:dragged={drag?.item.kind === "folder" && drag.item.id === folder.id}
                data-row-index={entry.index}
                data-depth={entry.depth}
                data-drag-kind="folder"
                data-drag-id={folder.id}
                data-drag-label={folder.name}
                data-folder-id={folder.id}
                style:--depth={entry.depth}
                role="none"
                oncontextmenu={(event) => (event.preventDefault(), (editingFolder = folder.id))}
              >
                <button
                  class="chevron"
                  aria-expanded={!folder.collapsed}
                  aria-label={folder.collapsed ? `Déplier le dossier ${folder.name}` : `Replier le dossier ${folder.name}`}
                  onclick={() => api.folders.update(folder.id, { collapsed: !folder.collapsed })}
                >
                  <span class="chevron-icon" class:open={!folder.collapsed}><Icon name="chevron-right" size={12} /></span>
                  <span class="folder-icon"><Icon name={folder.icon === "folder" && !folder.collapsed ? "folder-open" : folder.icon} size={16} /></span>
                  <span class="folder-name">{folder.name}</span>
                  {#if entry.folder.count}<span class="count">{entry.folder.count}</span>{/if}
                </button>
                <button class="icon small more" aria-label={`Modifier le dossier ${folder.name}`} title="Modifier le dossier" onclick={() => (editingFolder = editingFolder === folder.id ? null : folder.id)}>
                  <Icon name="more" size={14} />
                </button>
              </div>
            {:else}
              <div
                class="row"
                class:dragged={drag?.item.kind === "tab" && drag.item.id === entry.tab.id}
                data-row-index={entry.index}
                data-depth={entry.depth}
                data-drag-kind={entry.tab.isPinned ? undefined : "tab"}
                data-drag-id={entry.tab.id}
                data-drag-label={entry.tab.title}
                style:--depth={entry.depth}
                role="none"
              >
                <TabItem tab={entry.tab} active={entry.tab.id === browser.state.activeTabId} focusable={entry.tab.id === focusId} />
              </div>
            {/if}
          {/each}
          {#if indicator}
            <div class="drop-line" style:top="{indicator.top}px" style:--depth={indicator.depth} aria-hidden="true"></div>
          {/if}
        </div>
      </div>
    {/key}
    {#if swiping && neighbours.next}{@render peekView(neighbours.next, peekOf(neighbours.next.id), "next")}{/if}
    </div>
  </div>

  <!-- A neighbour space beside the shown one during a swipe: a still picture of its sidebar (inert). -->
  {#snippet peekView(space: SpaceInfo, peek: SpacePeek | undefined, side: "previous" | "next")}
    {@const pinned = peek?.tabs.filter((item) => item.isPinned) ?? []}
    <div class="space-content peek {side}" inert aria-hidden="true" data-peek={side}>
      <div class="space-title" style:--dot={space.color ?? "var(--accent)"}>
        <span class="space-icon"><Icon name={space.icon} size={16} /></span>
        <span class="space-name">{space.name}</span>
        {#if space.isolated}<span class="badge">Isolé</span>{/if}
        <span class="icon small"><Icon name="more" /></span>
      </div>
      {#if pinned.length}
        <div class="pinned">
          {#each pinned as item (item.id)}
            <div class="pinned-tab" class:active={item.id === peek?.activeTabId}><TabIcon tab={item} /></div>
          {/each}
        </div>
      {/if}
      <div class="divider"></div>
      <div class="new-row">
        <div class="new-tab"><Icon name="plus" size={16} /> <span class="label">Nouvel onglet</span></div>
        <span class="icon small"><Icon name="folder-plus" /></span>
      </div>
      <div class="tabs">
        {#each peek ? peekRows(peek) : [] as entry (entry.key)}
          <div class="row" class:folder-row={"folder" in entry} style:--depth={entry.depth}>
            {#if "folder" in entry}
              <div class="chevron">
                <span class="chevron-icon" class:open={!entry.folder.folder.collapsed}><Icon name="chevron-right" size={12} /></span>
                <span class="folder-icon"><Icon name={entry.folder.folder.icon === "folder" && !entry.folder.folder.collapsed ? "folder-open" : entry.folder.folder.icon} size={16} /></span>
                <span class="folder-name">{entry.folder.folder.name}</span>
                {#if entry.folder.count}<span class="count">{entry.folder.count}</span>{/if}
              </div>
            {:else}
              <TabItem tab={entry.tab} active={entry.tab.id === peek?.activeTabId} focusable={false} />
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/snippet}

  {#if editedSpace}
    <SpaceEditor space={editedSpace} onClose={() => (editing = null)} />
  {/if}
  {#if editedFolder && !editedSpace}
    <FolderEditor folder={editedFolder.folder} count={editedFolder.count} onClose={() => (editingFolder = null)} />
  {/if}
  {#if drag}
    <div class="drag-ghost" style:left="{drag.x + 12}px" style:top="{drag.y + 8}px" aria-hidden="true">
      <Icon name={drag.item.kind === "folder" ? "folder" : overFavorites ? "favorite" : "file"} size={12} />
      <span>{drag.label}</span>
    </div>
  {/if}
  <footer class="footer">
    {#if browser.isPrivate}
      <!-- One ephemeral space per private window: no switcher (ADR-014). -->
      <p class="private-hint" title="Cookies, cache et données de sites sont effacés à la fermeture de la fenêtre">
        Effacée à la fermeture
      </p>
    {:else}
      <SpaceSwitcher onEdit={(id) => (editing = editing === id ? null : id)} progress={swipeProgress} following={swiping && !settling} />
    {/if}
    <DownloadsButton />
    <ToolsMenu />
    <button class="icon" aria-label="Paramètres" title={platform.tip("Paramètres", "open-settings")} onclick={() => api.settings.open()}>
      <Icon name="settings" />
    </button>
  </footer>
</aside>

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--sidebar-gap);
    /* Never more than 45% of the window, whatever the saved width. */
    width: min(var(--sidebar-width), 45vw);
    min-width: 0;
    height: 100%;
    padding: 0 8px 8px;
    /* Narrow-sidebar rules of its parts (title bar, address bar, indentation) query this. */
    container: sidebar / inline-size;
  }
  .titlebar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    min-width: 0;
    height: 40px;
    margin-right: -4px;
  }
  .titlebar > :global(*) {
    flex: none;
  }
  .titlebar > .title-slot {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    height: 100%;
    overflow: hidden;
    container-type: inline-size;
  }
  .titlebar.mac {
    padding-left: 72px;
  }
  .spacer {
    flex: 1;
  }
  .nav {
    display: flex;
    gap: 2px;
    min-width: 0;
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--icon-button);
    height: var(--icon-button);
    border-radius: 8px;
    color: var(--text-muted);
  }
  .icon.on {
    color: var(--accent-text);
  }
  .icon:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }
  .icon:disabled {
    opacity: 0.35;
  }
  /* Tiles share the row: few pinned tabs fill it, many wrap onto more rows. */
  .pinned {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(44px, 1fr));
    gap: 6px;
    margin-top: 6px;
  }
  .pinned-tab {
    display: grid;
    place-items: center;
    height: 44px;
    border-radius: var(--radius);
    background: var(--surface);
  }
  .pinned-tab:hover {
    background: var(--surface-hover);
  }
  .pinned-tab.active {
    background: var(--bg-elevated);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent);
  }
  /* Asleep (page unloaded, reloads on click): dimmed, like in the tab list. */
  .pinned-tab.asleep:not(.active) > :global(*) {
    opacity: 0.45;
    filter: grayscale(0.6);
  }
  .private-badge {
    display: flex;
    flex: none;
    align-items: center;
    gap: 7px;
    margin-left: 6px;
    padding: 4px 10px 4px 8px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--accent) 22%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent);
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  /* Not enough room for the label: the icon alone (the tooltip and the accessible name stay). */
  @container (max-width: 180px) {
    .private-badge {
      margin-left: 2px;
      padding: 4px 5px;
    }
    .private-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
  .private-hint {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding-left: 6px;
    overflow: hidden;
    color: var(--text-faint);
    font-size: 11.5px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .divider {
    height: 1px;
    margin: 6px 4px;
    background: var(--border);
  }
  .new-tab {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
    height: calc(var(--tab-height) - 2px);
    padding: 0 11px;
    border-radius: var(--radius);
    color: var(--text-muted);
  }
  .new-tab .label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .new-tab :global(svg) {
    flex: none;
  }
  .new-tab:hover {
    background: var(--surface-hover);
    color: var(--text);
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
  .space-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
  }
  .space-title {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    margin-top: 4px;
    padding: 0 2px 0 8px;
  }
  .space-icon {
    display: grid;
    flex: none;
    place-items: center;
    color: color-mix(in oklab, var(--dot) 70%, var(--text));
  }
  .space-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: color-mix(in oklab, var(--dot) 55%, var(--text));
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .badge {
    flex: none;
    padding: 1px 6px;
    border-radius: 6px;
    background: color-mix(in oklab, var(--dot) 18%, transparent);
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .icon.small {
    width: 26px;
    height: 26px;
  }
  /*
   * Rows keep their height and the list scrolls (never squeezes). The 2px padding keeps the
   * active tab's ring and shadow inside the scroll box; the gutter stays reserved so the rows do
   * not shift when the scrollbar appears.
   */
  .tabs {
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
  .favorites-area {
    position: relative;
  }
  /* No tiles: takes no room (and no gap), even while its floating drop zone shows. */
  .favorites-area:not(:has(.tile, .empty-hint)) {
    height: 0;
    margin-bottom: calc(-1 * var(--sidebar-gap));
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
  .space-track.settling {
    transition: transform var(--settle) cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .peek {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 100%;
    overflow: hidden;
    pointer-events: none;
  }
  .peek.previous {
    right: calc(100% + var(--peek-gap));
  }
  .peek.next {
    left: calc(100% + var(--peek-gap));
  }
  .peek .tabs {
    overflow: hidden;
  }
  .new-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .new-row .new-tab {
    flex: 1;
  }
  .tabs {
    position: relative;
  }
  .tabs.dragging {
    cursor: grabbing;
  }
  /* Indentation narrows with the sidebar: four levels deep must not crush the titles. */
  .row {
    flex: none;
    min-width: 0;
    padding-left: calc(var(--depth, 0) * var(--indent));
  }
  .sidebar {
    --indent: clamp(8px, 5cqi, 14px);
  }
  .row.dragged {
    opacity: 0.4;
  }
  .folder-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--radius);
  }
  .folder-row:hover {
    background: var(--surface-hover);
  }
  .folder-row.drop-inside {
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent-text) 55%, transparent);
  }
  .chevron {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: calc(var(--tab-height) - 4px);
    padding: 0 6px 0 4px;
    border-radius: var(--radius);
    color: var(--text-muted);
    font-weight: 600;
  }
  .chevron:hover {
    color: var(--text);
  }
  .chevron-icon {
    display: grid;
    flex: none;
    place-items: center;
    transition: transform 0.15s var(--ease);
  }
  .chevron-icon.open {
    transform: rotate(90deg);
  }
  .folder-icon {
    display: grid;
    flex: none;
    place-items: center;
  }
  .folder-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .count {
    flex: none;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 600;
  }
  .folder-row .more {
    opacity: 0;
  }
  .folder-row:hover .more,
  .folder-row .more:focus-visible {
    opacity: 1;
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
  .footer {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    min-width: 0;
    margin-top: auto;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
</style>
