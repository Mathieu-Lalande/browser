<script lang="ts">
  import { api, browser } from "./lib/browser.svelte";
  import HttpsOnlyPage from "./components/HttpsOnlyPage.svelte";
  import Icon from "./components/Icon.svelte";
  import PermissionBar from "./components/PermissionBar.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import StartPage from "./components/StartPage.svelte";

  let sidebarVisible = $state(true);
  let sidebar = $state<Sidebar>();
  let viewport: HTMLElement;

  const showStartPage = $derived(!browser.activeTab?.url);
  const permissionRequest = $derived(browser.activeTab?.permissionRequest ?? null);

  function toggleSidebar(): void {
    sidebarVisible = !sidebarVisible;
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
        sidebarVisible = true;
        queueMicrotask(() => sidebar?.focusAddress());
      }
    });
  });
</script>

<div class="shell" class:collapsed={!sidebarVisible}>
  {#if sidebarVisible}
    <Sidebar bind:this={sidebar} onToggle={toggleSidebar} />
  {:else}
    <div class="reveal drag">
      <button class="no-drag" aria-label="Afficher la barre latérale" onclick={toggleSidebar}><Icon name="sidebar" /></button>
    </div>
  {/if}
  <div class="content">
    <!-- The page view is native and cannot be drawn over: the bar shrinks the viewport instead. -->
    {#if browser.activeTab && permissionRequest}
      <PermissionBar tabId={browser.activeTab.id} prompt={permissionRequest} />
    {/if}
    <main class="viewport" bind:this={viewport}>
      {#if showStartPage}<StartPage />{:else if browser.activeTab?.interstitial}<HttpsOnlyPage tab={browser.activeTab} />{/if}
    </main>
  </div>
</div>

<style>
  .shell {
    display: flex;
    height: 100%;
    padding: var(--gutter) var(--gutter) var(--gutter) 0;
  }
  .shell.collapsed {
    padding-left: 0;
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
  .content {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--gutter);
    min-width: 0;
  }
  .viewport {
    flex: 1;
    min-width: 0;
    min-height: 0;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 10px 30px -12px rgb(0 0 0 / 0.5);
  }
</style>
