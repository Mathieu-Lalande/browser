<script lang="ts">
  import { internalPageOf } from "@shared/internal";
  import { accentVariables } from "@shared/theme";
  import { siteAccent } from "@shared/site-color";
  import { tick, untrack } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { api, browser } from "./lib/browser.svelte";
  import ReaderView from "./components/reader/ReaderView.svelte";
  import InternalPage from "./components/InternalPage.svelte";
  import FindBar from "./components/FindBar.svelte";
  import HttpsOnlyPage from "./components/HttpsOnlyPage.svelte";
  import LoadErrorPage from "./components/LoadErrorPage.svelte";
  import WindowBar, { type SidebarMode } from "./components/WindowBar.svelte";
  import { settings } from "./lib/settings.svelte";
  import { applyTheme } from "./lib/theme";
  import { installRecorder } from "./lib/recorder";
  import { animateAccent, faviconColor, type AccentVars } from "./lib/dynamic-accent";
  import PermissionBar from "./components/PermissionBar.svelte";
  import PopupBar from "./components/PopupBar.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import CompactRail from "./components/CompactRail.svelte";
  import SidebarResizer from "./components/SidebarResizer.svelte";
  import SplitView from "./components/split/SplitView.svelte";
  import StartPage from "./components/StartPage.svelte";
  import NotesPanel from "./components/annotations/NotesPanel.svelte";
  import AssistantPanel from "./components/assistant/AssistantPanel.svelte";
  import { assistantPanel } from "./lib/assistant.svelte";

  /** Delay before a revealed zen sidebar hides once the pointer left it. */
  const ZEN_HIDE_DELAY = 450;

  let sidebarVisible = $state(true);
  /** Zen mode only: the sidebar is temporarily shown (edge hovered, Ctrl+S, Ctrl+L). */
  let revealed = $state(false);
  let sidebar = $state<Sidebar>();
  let sidebarFrame = $state<HTMLElement>();
  let viewport: HTMLElement;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const layout = $derived(settings.current.layout);
  const zen = $derived(layout.zenMode);
  /** Compact mode (ADR-033): a rail of tab icons that unfolds into the sidebar while hovered. */
  const compact = $derived(layout.compactMode && !zen);
  let unfolded = $state(false);
  let unfoldTimer: ReturnType<typeof setTimeout> | undefined;
  const folded = $derived(compact && !unfolded);
  const right = $derived(layout.sidebarPosition === "right");
  const showSidebar = $derived(zen ? revealed : sidebarVisible);
  const showStartPage = $derived(!browser.activeTab?.url);
  const permissionRequest = $derived(browser.activeTab?.permissionRequest ?? null);
  const blockedPopup = $derived(browser.activeTab?.blockedPopup ?? null);
  /** The active space's accent (null: the theme's own accent). */
  const spaceColor = $derived(browser.activeSpace?.color ?? null);
  const internalPage = $derived(internalPageOf(browser.activeTab?.url ?? ""));
  /** The zoom of the pages drawn here (start page, browser://…): theirs alone, never the sidebar's (ADR-045). */
  const pageZoom = $derived((browser.activeTab?.zoom ?? 100) / 100);
  /** Find bar of the active tab, over web pages only. */
  const findState = $derived(
    browser.activeTab?.find?.open && !showStartPage && !internalPage && !browser.activeTab.interstitial && !browser.activeTab.loadError && !browser.activeTab.reader
      ? browser.activeTab.find
      : null,
  );
  let findBar = $state<FindBar>();
  /** The notes panel (ADR-037), beside web pages: it narrows the viewport. */
  let notesOpen = $state(false);
  const showNotes = $derived(notesOpen && !!browser.activeTab && /^https?:/.test(browser.activeTab.url) && !internalPage);
  /** The assistant panel (ADR-044), beside any page but the internal ones: it narrows the viewport too. */
  const showAssistant = $derived(assistantPanel.open && !!browser.activeTab && !internalPage);
  let findFocusPending = $state(false);
  /**
   * The space color goes through the theme's contrast engine (clamped lightness, WCAG-adjusted
   * accent text, readable ink on accent fills), like the theme accent itself.
   */
  /**
   * Dynamic theme (ADR-038, never in a private window: its theme stays recognizable): the web
   * page on screen lends its color (`theme-color`, else its favicon's), else the space color.
   */
  const dynamicTheme = $derived(settings.current.appearance.dynamicTheme && !browser.isPrivate);
  const siteTab = $derived(dynamicTheme && /^https?:/.test(browser.activeTab?.url ?? "") ? browser.activeTab : null);
  let siteFaviconColor = $state<string | null>(null);
  $effect(() => {
    const favicon = siteTab?.favicon;
    let current = true;
    if (favicon) void faviconColor(favicon).then((color) => current && (siteFaviconColor = color));
    else siteFaviconColor = null;
    return () => (current = false);
  });
  const siteColor = $derived(siteTab ? siteAccent({ themeColor: siteTab.themeColor, faviconColor: siteFaviconColor }) : null);
  const accentColor = $derived(siteColor ?? spaceColor);
  const targetAccent = $derived(accentColor ? accentVariables(accentColor, browser.isPrivate ? "dark" : settings.mode) : null);
  /** What the shell shows: `targetAccent`, reached through a short transition (`--motion-base`). */
  let spaceAccent = $state<AccentVars | null>(null);
  $effect(() => {
    const target = targetAccent;
    return untrack(() => animateAccent(spaceAccent, target, (value) => (spaceAccent = value)));
  });
  /** Zen and Ctrl+S: the sidebar grows/shrinks (the page view follows, one bounds update per frame). */
  function slide(node: HTMLElement, { duration = 180 }: { duration?: number } = {}) {
    const width = node.offsetWidth;
    return {
      duration,
      easing: cubicOut,
      css: (t: number) => `width: ${t * width}px; overflow: hidden;`,
    };
  }

  // Theme: every setting maps to CSS variables on :root, re-applied live.
  $effect(() => applyTheme(settings.current, settings.mode, browser.isPrivate, { energySaver: browser.state.energy?.active, mica: browser.state.mica }));
  // Tab recording (ADR-031): main starts and stops the recorder that lives in this page.
  $effect(() => installRecorder());

  // Entering or leaving zen (or compact) mode starts with the sidebar tucked away.
  $effect(() => {
    void zen;
    void compact;
    revealed = false;
    unfolded = false;
  });

  /** The window bar's choice (ADR-045): one layout among full, compact and zen; picking one shows the sidebar. */
  const sidebarMode = $derived<SidebarMode>(zen ? "zen" : !sidebarVisible ? "hidden" : compact ? "compact" : "full");
  function setSidebarMode(mode: Exclude<SidebarMode, "hidden">): void {
    if (mode === "zen") settings.update({ layout: { zenMode: true } });
    else {
      settings.update({ layout: { zenMode: false, compactMode: mode === "compact" } });
      sidebarVisible = true;
    }
  }

  function toggleSidebar(): void {
    if (zen) revealed = !revealed;
    else sidebarVisible = !sidebarVisible;
  }

  function showSidebarNow(): void {
    clearTimeout(hideTimer);
    if (compact) unfolded = true;
    if (zen) revealed = true;
    else sidebarVisible = true;
  }

  /** Zen mode: hide the revealed sidebar shortly after the pointer leaves it, unless the user is typing in it. */
  function scheduleHide(delay = ZEN_HIDE_DELAY): void {
    clearTimeout(unfoldTimer);
    if (!zen && !compact) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const active = document.activeElement;
      const typing = active instanceof HTMLInputElement && sidebarFrame?.contains(active);
      if (typing || sidebarFrame?.matches(":hover")) return;
      if (zen) revealed = false;
      else unfolded = false;
    }, delay);
  }

  /** Compact mode: the rail unfolds once the pointer rests on it a moment (not when merely crossed). */
  function onFrameEnter(): void {
    clearTimeout(hideTimer);
    if (!folded) return;
    clearTimeout(unfoldTimer);
    unfoldTimer = setTimeout(() => (unfolded = true), 140);
  }

  function revealFromEdge(): void {
    showSidebarNow();
    // The sidebar appears under a pointer that may never "enter" it (a quick flick back onto the
    // page): check again a bit later instead of waiting for a mouseleave that would not come.
    scheduleHide(ZEN_HIDE_DELAY * 2);
  }

  // Keep the native page view glued to the viewport element.
  $effect(() => {
    // At most one bounds update per frame: while the sidebar slides, the page follows it frame by
    // frame instead of receiving a burst of IPC messages (or jumping once at the end).
    let frame = 0;
    let last = "";
    const send = () => {
      frame = 0;
      const rect = viewport.getBoundingClientRect();
      const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      const key = JSON.stringify(bounds);
      if (key === last) return;
      last = key;
      api.layout.setContentBounds(bounds);
    };
    const report = () => {
      if (!frame) frame = requestAnimationFrame(send);
    };
    const observer = new ResizeObserver(report);
    observer.observe(viewport);
    window.addEventListener("resize", report);
    send();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  });

  $effect(() => {
    return api.onUiCommand((command) => {
      if (command === "toggle-sidebar") toggleSidebar();
      if (command === "focus-address") {
        showSidebarNow();
        void tick().then(() => sidebar?.focusAddress());
      }
      // Sidebar menus (ADR-033): selection and space editor, the sidebar shown first.
      if (command === "select-all-tabs") {
        showSidebarNow();
        void tick().then(() => sidebar?.selectAllTabs());
      }
      const space = /^(?:edit|rename)-space:(.+)$/.exec(command)?.[1];
      if (space) {
        showSidebarNow();
        void tick().then(() => sidebar?.editSpace(space));
      }
      // The bar may not be rendered yet (its state is on its way): focused as soon as it is.
      if (command === "focus-find") findFocusPending = true;
      if (command === "toggle-notes") notesOpen = !notesOpen;
      if (command === "toggle-assistant") assistantPanel.toggle();
      if (command === "open-assistant") assistantPanel.open = true;
    });
  });

  $effect(() => {
    if (findFocusPending && findBar) {
      findFocusPending = false;
      findBar.focus();
    }
  });
</script>

<!-- The space color overrides the accent for everything inside the shell (theme layer: `--space-color`). -->
<div
  class="shell"
  class:tinted={spaceAccent}
  style:--space-color={spaceAccent?.["--accent"]}
  style:--accent={spaceAccent?.["--accent"]}
  style:--accent-text={spaceAccent?.["--accent-text"]}
  style:--on-accent={spaceAccent?.["--on-accent"]}
>
  <!-- Window buttons, zen and sidebar toggles: unfolded from the top edge only (ADR-045). -->
  <WindowBar mode={sidebarMode} onMode={setSidebarMode} />
  <div class="panes" class:right class:zen class:collapsed={!showSidebar}>
    {#if showSidebar}
      <!-- Pointer tracking only (zen auto-hide); every control inside stays keyboard reachable. -->
      <div
        class="sidebar-frame"
        transition:slide
        bind:this={sidebarFrame}
        role="presentation"
        class:compact
        onmouseenter={onFrameEnter}
        onmouseleave={() => scheduleHide()}
        onfocusout={() => scheduleHide()}
      >
        {#if folded}
          <CompactRail />
        {:else}
          <Sidebar bind:this={sidebar} />
          <SidebarResizer side={right ? "right" : "left"} />
        {/if}
      </div>
    {:else if zen}
      <!-- A thin strip left uncovered by the page view: the chrome UI cannot see the pointer over the page. -->
      <div class="edge" role="presentation" data-testid="zen-edge" onmouseenter={revealFromEdge}></div>
    {/if}
    <div class="content">
      <!-- The page view is native and cannot be drawn over: the bar shrinks the viewport instead. -->
      {#if browser.activeTab && permissionRequest}
        <PermissionBar tabId={browser.activeTab.id} prompt={permissionRequest} />
      {/if}
      {#if browser.activeTab && blockedPopup && !permissionRequest}
        <PopupBar tabId={browser.activeTab.id} popup={blockedPopup} />
      {/if}
      {#if browser.activeTab && findState}
        {#key browser.activeTab.id}
          <FindBar bind:this={findBar} tabId={browser.activeTab.id} find={findState} />
        {/key}
      {/if}
      <div class="page-row" class:notes-left={right}>
      <main class="viewport" class:split={browser.splitTabs.length > 1} bind:this={viewport}>
        {#if browser.splitTabs.length > 1 && browser.state.split}
          <SplitView tabs={browser.splitTabs} split={browser.state.split} />
        {:else if showStartPage}
          <div class="drawn-page" style:zoom={pageZoom}><StartPage /></div>
        {:else if internalPage}
          <div class="drawn-page" style:zoom={pageZoom}><InternalPage page={internalPage} /></div>
        {:else if browser.activeTab?.interstitial}
          <HttpsOnlyPage tab={browser.activeTab} />
        {:else if browser.activeTab?.loadError}
          <LoadErrorPage tab={browser.activeTab} error={browser.activeTab.loadError} />
        {:else if browser.activeTab?.reader}
          <ReaderView tab={browser.activeTab} />
        {/if}
      </main>
      {#if showNotes && browser.activeTab}
        <NotesPanel tab={browser.activeTab} onClose={() => (notesOpen = false)} />
      {/if}
      {#if showAssistant && browser.activeTab}
        <AssistantPanel tab={browser.activeTab} onClose={() => (assistantPanel.open = false)} />
      {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .shell {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .shell.tinted {
    background: radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, var(--space-color) 14%, transparent), transparent 60%);
    transition: background var(--motion-base) var(--ease);
  }
  /* Sidebar and page, below the window bar (which is the top gutter while folded). */
  .panes {
    display: flex;
    flex: 1;
    min-height: 0;
    padding: 0 var(--gutter) var(--gutter) 0;
  }
  /* Sidebar hidden: the page keeps a gutter on both sides. */
  .panes.collapsed {
    padding-left: var(--gutter);
  }
  .panes.right {
    flex-direction: row-reverse;
    padding: 0 0 var(--gutter) var(--gutter);
  }
  .panes.right.collapsed {
    padding-right: var(--gutter);
  }
  .sidebar-frame {
    position: relative;
    display: flex;
    flex: none;
  }
  .content {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--gutter);
    min-width: 0;
  }
  .edge {
    flex: none;
    width: 6px;
    background: linear-gradient(to right, color-mix(in oklab, var(--accent) 30%, transparent), transparent);
  }
  .panes.right .edge {
    background: linear-gradient(to left, color-mix(in oklab, var(--accent) 30%, transparent), transparent);
  }
  .page-row {
    display: flex;
    flex: 1;
    gap: var(--gutter);
    min-height: 0;
  }
  /* The panel sits on the side away from the sidebar. */
  .page-row.notes-left {
    flex-direction: row-reverse;
  }
  .viewport {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--page-radius, var(--radius));
    background: var(--bg-elevated);
    box-shadow: var(--viewport-shadow);
  }
  /* A page drawn by the UI, at its own zoom: it still fills the card (percentages are not zoomed). */
  .drawn-page {
    width: 100%;
    height: 100%;
  }
  /* Split view: each pane draws its own card. */
  .viewport.split {
    overflow: visible;
    background: none;
    box-shadow: none;
  }
</style>
