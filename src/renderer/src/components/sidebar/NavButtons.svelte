<script lang="ts">
  import { api, browser } from "../../lib/browser.svelte";
  import IconButton from "../ui/IconButton.svelte";

  /** The sidebar's navigation row: app menu, back/forward/reload, split view and universal bar. */
  const tab = $derived(browser.activeTab);
  const split = $derived(browser.splitTabs.length > 1);
  let appMenuButton = $state<HTMLElement>();

  function showAppMenu(): void {
    const rect = appMenuButton?.getBoundingClientRect();
    if (rect) api.appMenu.show({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
</script>

<nav class="nav">
  <IconButton
    bind:element={appMenuButton}
    icon="more"
    label="Menu de l'application"
    title="Menu : synchronisation, historique, favoris, outils, aide…"
    aria-haspopup="menu"
    data-testid="app-menu-button"
    onclick={showAppMenu}
  />
  <IconButton icon="back" label="Précédent" command="back" disabled={!tab?.canGoBack} onclick={() => tab && api.tabs.back(tab.id)} />
  <IconButton icon="forward" label="Suivant" command="forward" disabled={!tab?.canGoForward} onclick={() => tab && api.tabs.forward(tab.id)} />
  {#if tab?.isLoading}
    <IconButton icon="stop" label="Arrêter" title="Arrêter le chargement" onclick={() => tab && api.tabs.stop(tab.id)} />
  {:else}
    <IconButton icon="reload" label="Actualiser" command="reload" disabled={!tab?.url} onclick={() => tab && api.tabs.reload(tab.id)} />
  {/if}
  <div class="spacer"></div>
  <IconButton
    icon="split"
    on={split}
    label={split ? "Quitter la vue scindée" : "Vue scindée"}
    title={split ? "Quitter la vue scindée" : "Vue scindée : afficher deux onglets côte à côte"}
    command="toggle-split"
    onclick={() => api.commands.run("toggle-split")}
  />
  <IconButton
    icon="command"
    label="Barre universelle"
    title="Barre universelle : onglets, pages, actions, réglages et calculs"
    command="command-palette"
    onclick={() => api.commands.run("command-palette")}
  />
</nav>

<style>
  .nav {
    display: flex;
    gap: 2px;
    min-width: 0;
  }
  .spacer {
    flex: 1;
  }
</style>
