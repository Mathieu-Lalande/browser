<script lang="ts">
  import { internalPageOf } from "@shared/internal";
  import { api, browser } from "./lib/browser.svelte";
  import { settings } from "./lib/settings.svelte";
  import { applyTheme } from "./lib/theme";
  import Icon from "./components/Icon.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import SidebarResizer from "./components/SidebarResizer.svelte";
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
  const internalPage = $derived(internalPageOf(browser.activeTab?.url ?? ""));
  // macOS draws its traffic lights top-left: with the sidebar on the right, keep them off the page.
  const trafficLights = $derived(window.platform === "darwin" && right && !zen);

  // Theme: every setting maps to CSS variables on :root, re-applied live.
  $effect(() => applyTheme(settings.current, settings.mode));

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
    const report = () => {
      const rect = viewport.getBoundingClientRect();
      api.layout.setContentBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(report);
    observer.observe(viewport);
    window.addEventListener("resize", report);
    report();
    return () => {
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
    });
  });
</script>

<div class="shell" class:right class:zen class:collapsed={!showSidebar} class:lights={trafficLights}>
  {#if trafficLights}<div class="lights drag"></div>{/if}
  {#if showSidebar}
    <!-- Pointer tracking only (zen auto-hide); every control inside stays keyboard reachable. -->
    <div
      class="sidebar-frame"
      bind:this={sidebarFrame}
      role="presentation"
      onmouseenter={() => clearTimeout(hideTimer)}
      onmouseleave={() => scheduleHide()}
      onfocusout={() => scheduleHide()}
    >
      <Sidebar bind:this={sidebar} onToggle={toggleSidebar} />
      <SidebarResizer side={right ? "right" : "left"} />
    </div>
  {:else if zen}
    <!-- A thin strip left uncovered by the page view: the chrome UI cannot see the pointer over the page. -->
    <div class="edge" role="presentation" data-testid="zen-edge" onmouseenter={revealFromEdge}></div>
  {:else}
    <div class="reveal drag">
      <button class="no-drag" aria-label="Afficher la barre latérale" onclick={toggleSidebar}><Icon name="sidebar" /></button>
    </div>
  {/if}
  <main class="viewport" bind:this={viewport}>
    {#if showStartPage}
      <StartPage />
    {:else if internalPage === "settings"}
      <SettingsPage />
    {/if}
  </main>
</div>

<style>
  .shell {
    position: relative;
    display: flex;
    height: 100%;
    padding: var(--gutter) var(--gutter) var(--gutter) 0;
  }
  .shell.collapsed {
    padding-left: 0;
  }
  .shell.right {
    flex-direction: row-reverse;
    padding: var(--gutter) 0 var(--gutter) var(--gutter);
  }
  .shell.right.collapsed {
    padding-right: 0;
  }
  .shell.lights {
    padding-top: 36px;
  }
  .lights {
    position: absolute;
    inset: 0 0 auto 0;
    height: 36px;
  }
  .sidebar-frame {
    position: relative;
    display: flex;
    flex: none;
  }
  .reveal {
    display: flex;
    justify-content: center;
    width: 40px;
    padding-top: 6px;
  }
  .reveal button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: var(--text-muted);
  }
  .reveal button:hover {
    background: var(--surface-hover);
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
    overflow: hidden;
    border-radius: var(--page-radius, var(--radius));
    background: var(--bg-elevated);
    box-shadow: var(--viewport-shadow);
  }
</style>
