<script lang="ts">
  import { internalPageOf } from "@shared/internal";
  import { accentVariables } from "@shared/theme";
  import { cubicOut } from "svelte/easing";
  import { api, browser } from "./lib/browser.svelte";
  import DownloadsPage from "./components/downloads/DownloadsPage.svelte";
  import ArchivePage from "./components/folders/ArchivePage.svelte";
  import ExtensionsPage from "./components/extensions/ExtensionsPage.svelte";
  import PasswordsPage from "./components/passwords/PasswordsPage.svelte";
  import BoostsPage from "./components/boosts/BoostsPage.svelte";
  import ReaderView from "./components/reader/ReaderView.svelte";
  import FindBar from "./components/FindBar.svelte";
  import HttpsOnlyPage from "./components/HttpsOnlyPage.svelte";
  import LoadErrorPage from "./components/LoadErrorPage.svelte";
  import { platform } from "./lib/platform.svelte";
  import WindowControls from "./components/WindowControls.svelte";
  import { settings } from "./lib/settings.svelte";
  import { applyTheme } from "./lib/theme";
  import Icon from "./components/Icon.svelte";
  import PermissionBar from "./components/PermissionBar.svelte";
  import PopupBar from "./components/PopupBar.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import SidebarResizer from "./components/SidebarResizer.svelte";
  import SplitView from "./components/split/SplitView.svelte";
  import StartPage from "./components/StartPage.svelte";
  import SettingsPage from "./components/settings/SettingsPage.svelte";

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
  const right = $derived(layout.sidebarPosition === "right");
  const showSidebar = $derived(zen ? revealed : sidebarVisible);
  const showStartPage = $derived(!browser.activeTab?.url);
  const permissionRequest = $derived(browser.activeTab?.permissionRequest ?? null);
  const blockedPopup = $derived(browser.activeTab?.blockedPopup ?? null);
  /** The active space's accent (null: the theme's own accent). */
  const spaceColor = $derived(browser.activeSpace?.color ?? null);
  const internalPage = $derived(internalPageOf(browser.activeTab?.url ?? ""));
  /** Find bar of the active tab, over web pages only. */
  const findState = $derived(
    browser.activeTab?.find?.open && !showStartPage && !internalPage && !browser.activeTab.interstitial && !browser.activeTab.loadError && !browser.activeTab.reader
      ? browser.activeTab.find
      : null,
  );
  let findBar = $state<FindBar>();
  let findFocusPending = $state(false);
  /**
   * The space color goes through the theme's contrast engine (clamped lightness, WCAG-adjusted
   * accent text, readable ink on accent fills), like the theme accent itself.
   */
  const spaceAccent = $derived(spaceColor ? accentVariables(spaceColor, browser.isPrivate ? "dark" : settings.mode) : null);
  /** The sidebar is hidden by the user (Ctrl+S), outside zen mode: its toggle moves to the window bar. */
  const collapsed = $derived(!showSidebar && !zen);
  /**
   * Window buttons. macOS: native traffic lights at the top-left, kept clear of the UI by the
   * sidebar's title bar (sidebar on the left), a 36px band (sidebar on the right) or the window
   * bar's left padding (sidebar hidden); main hides them in zen mode. Windows/Linux (frameless):
   * minimize/maximize/close drawn at the window's outer top-right corner: in the sidebar's title
   * bar when it is on the right (or revealed in zen mode), else in a draggable bar above the page,
   * which shrinks to a thin drag strip in zen mode.
   */
  const trafficLights = $derived(platform.isMac && !zen && right && showSidebar);
  const controlsInSidebar = $derived(!platform.isMac && showSidebar);
  /**
   * Windows/Linux with the sidebar hidden (Ctrl+S or zen): the page keeps the full height, and the
   * window bar only unfolds while the pointer is at the very top of the window (a thin strip the
   * page view does not cover), then folds back once the pointer leaves it.
   */
  let topReveal = $state(false);
  let topTimer: ReturnType<typeof setTimeout> | undefined;
  const topEdge = $derived(!platform.isMac && !showSidebar && !topReveal);
  const windowBar = $derived(platform.isMac ? collapsed : !showSidebar && topReveal);
  const barControls = $derived(!platform.isMac);

  function revealTop(): void {
    clearTimeout(topTimer);
    topReveal = true;
  }

  function hideTop(): void {
    clearTimeout(topTimer);
    topTimer = setTimeout(() => (topReveal = false), 350);
  }

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
  $effect(() => applyTheme(settings.current, settings.mode, browser.isPrivate));

  // Entering or leaving zen mode starts with the sidebar tucked away.
  $effect(() => {
    void zen;
    revealed = false;
  });

  function toggleSidebar(): void {
    if (zen) revealed = !revealed;
    else sidebarVisible = !sidebarVisible;
  }

  function showSidebarNow(): void {
    clearTimeout(hideTimer);
    if (zen) revealed = true;
    else sidebarVisible = true;
  }

  /** Zen mode: hide the revealed sidebar shortly after the pointer leaves it, unless the user is typing in it. */
  function scheduleHide(delay = ZEN_HIDE_DELAY): void {
    if (!zen) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const active = document.activeElement;
      const typing = active instanceof HTMLInputElement && sidebarFrame?.contains(active);
      if (!typing && !sidebarFrame?.matches(":hover")) revealed = false;
    }, delay);
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
        queueMicrotask(() => sidebar?.focusAddress());
      }
      // The bar may not be rendered yet (its state is on its way): focused as soon as it is.
      if (command === "focus-find") findFocusPending = true;
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
  class:right
  class:zen
  class:collapsed={!showSidebar}
  class:lights={trafficLights}
  class:barred={windowBar || topEdge}
  class:tinted={spaceAccent}
  style:--space-color={spaceAccent?.["--accent"]}
  style:--accent={spaceAccent?.["--accent"]}
  style:--accent-text={spaceAccent?.["--accent-text"]}
  style:--on-accent={spaceAccent?.["--on-accent"]}
>
  {#if trafficLights}<div class="lights-band drag" data-testid="traffic-lights-band"></div>{/if}
  {#if showSidebar}
    <!-- Pointer tracking only (zen auto-hide); every control inside stays keyboard reachable. -->
    <div
      class="sidebar-frame"
      transition:slide
      bind:this={sidebarFrame}
      role="presentation"
      onmouseenter={() => clearTimeout(hideTimer)}
      onmouseleave={() => scheduleHide()}
      onfocusout={() => scheduleHide()}
    >
      <Sidebar bind:this={sidebar} onToggle={toggleSidebar} windowControls={controlsInSidebar} />
      <SidebarResizer side={right ? "right" : "left"} />
    </div>
  {:else if zen}
    <!-- A thin strip left uncovered by the page view: the chrome UI cannot see the pointer over the page. -->
    <div class="edge" role="presentation" data-testid="zen-edge" onmouseenter={revealFromEdge}></div>
  {/if}
  <div class="content">
    {#if topEdge}
      <!-- Not covered by the page view: hovering it unfolds the window bar. Not a drag region:
           those swallow mouse events, so hovering would never be seen. -->
      <div class="top-edge" role="presentation" data-testid="top-edge" onmouseenter={revealTop}></div>
    {/if}
    {#if windowBar}
      <!-- Its empty middle moves the window (macOS: the whole bar), whatever the sidebar's state. -->
      <div
        class="window-bar"
        class:drag={platform.isMac}
        class:mac={platform.isMac}
        role="presentation"
        data-testid="window-bar"
        onmouseenter={revealTop}
        onmouseleave={() => !platform.isMac && hideTop()}
      >
        {#if collapsed}
          <button
            class="reveal no-drag"
            aria-label="Afficher la barre latérale"
            title={platform.tip("Afficher la barre latérale", "toggle-sidebar")}
            onclick={toggleSidebar}
          >
            <Icon name="sidebar" />
          </button>
        {/if}
        <span class="bar-spacer drag"></span>
        {#if barControls}<WindowControls />{/if}
      </div>
    {/if}
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
    <main class="viewport" class:split={browser.splitTabs.length > 1} bind:this={viewport}>
      {#if browser.splitTabs.length > 1 && browser.state.split}
        <SplitView tabs={browser.splitTabs} split={browser.state.split} />
      {:else if showStartPage}
        <StartPage />
      {:else if internalPage === "settings"}
        <SettingsPage />
      {:else if internalPage === "downloads"}
        <DownloadsPage />
      {:else if internalPage === "archive"}
        <ArchivePage />
      {:else if internalPage === "extensions"}
        <ExtensionsPage />
      {:else if internalPage === "passwords"}
        <PasswordsPage />
      {:else if internalPage === "boosts"}
        <BoostsPage />
      {:else if browser.activeTab?.interstitial}
        <HttpsOnlyPage tab={browser.activeTab} />
      {:else if browser.activeTab?.loadError}
        <LoadErrorPage tab={browser.activeTab} error={browser.activeTab.loadError} />
      {:else if browser.activeTab?.reader}
        <ReaderView tab={browser.activeTab} />
      {/if}
    </main>
  </div>
</div>

<style>
  .shell {
    position: relative;
    display: flex;
    height: 100%;
    padding: var(--gutter) var(--gutter) var(--gutter) 0;
  }
  /* Sidebar hidden: the page keeps a gutter on both sides. */
  .shell.collapsed {
    padding-left: var(--gutter);
  }
  .shell.tinted {
    background: radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, var(--space-color) 14%, transparent), transparent 60%);
    transition: background 0.3s var(--ease);
  }
  .shell.right {
    flex-direction: row-reverse;
    padding: var(--gutter) 0 var(--gutter) var(--gutter);
  }
  .shell.right.collapsed {
    padding-right: var(--gutter);
  }
  .shell.lights {
    padding-top: 36px;
  }
  /* The window bar replaces the top gutter of the page column. */
  .shell.barred {
    padding-top: 0;
  }
  .window-bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    height: 40px;
    /* The buttons sit at the window's edge, not at the page's. */
    margin-right: calc(4px - var(--gutter));
  }
  .shell.collapsed .window-bar {
    margin-left: calc(4px - var(--gutter));
  }
  /* Sidebar on the right: its toggle sits on that side, next to the window buttons. */
  .shell.right .reveal {
    order: 2;
  }
  .shell.right .window-bar :global(.controls) {
    order: 3;
  }
  /* macOS: room for the traffic lights (16px from the left edge, about 52px wide). */
  .window-bar.mac {
    padding-left: 72px;
  }
  .bar-spacer {
    flex: 1;
  }
  .reveal {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--text-muted);
  }
  .reveal:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  /* Replaces the top gutter (the column's gap is cancelled): the page starts where it did. */
  .top-edge {
    flex: none;
    height: max(var(--gutter), 8px);
    margin-bottom: calc(-1 * var(--gutter));
  }
  /* Not `.lights`: that is the shell's own modifier class (it made the whole shell 36px tall). */
  .lights-band {
    position: absolute;
    inset: 0 0 auto 0;
    height: 36px;
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
  .shell.right .edge {
    background: linear-gradient(to left, color-mix(in oklab, var(--accent) 30%, transparent), transparent);
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
  /* Split view: each pane draws its own card. */
  .viewport.split {
    overflow: visible;
    background: none;
    box-shadow: none;
  }
</style>
