<script lang="ts">
  import { t } from "@shared/i18n";
  import { api, browser } from "../../lib/browser.svelte";
  import IconButton from "../ui/IconButton.svelte";

  /**
   * The sidebar's first row (ADR-045): back/forward/reload, then split view and the universal bar.
   * The window buttons live in the window bar, the app menu in the footer.
   */
  const tab = $derived(browser.activeTab);
  const split = $derived(browser.splitTabs.length > 1);
</script>

<nav class="nav">
  <IconButton icon="back" label={t("navButtons.back")} command="back" disabled={!tab?.canGoBack} onclick={() => tab && api.tabs.back(tab.id)} />
  <IconButton icon="forward" label={t("navButtons.forward")} command="forward" disabled={!tab?.canGoForward} onclick={() => tab && api.tabs.forward(tab.id)} />
  {#if tab?.isLoading}
    <IconButton icon="stop" label={t("navButtons.stop")} title={t("navButtons.stopLoading")} onclick={() => tab && api.tabs.stop(tab.id)} />
  {:else}
    <IconButton icon="reload" label={t("navButtons.reload")} command="reload" disabled={!tab?.url} onclick={() => tab && api.tabs.reload(tab.id)} />
  {/if}
  <div class="spacer"></div>
  <IconButton
    icon="split"
    on={split}
    label={split ? t("navButtons.leaveSplitView") : t("navButtons.splitView")}
    title={split ? t("navButtons.leaveSplitView") : t("navButtons.splitViewShowTwo")}
    command="toggle-split"
    onclick={() => api.commands.run("toggle-split")}
  />
  <IconButton
    icon="command"
    label={t("navButtons.universalBar")}
    title={t("navButtons.universalBarTabsPages")}
    command="command-palette"
    onclick={() => api.commands.run("command-palette")}
  />
</nav>

<style>
  .nav {
    display: flex;
    flex: none;
    gap: 2px;
    min-width: 0;
    margin-top: 2px;
  }
  .spacer {
    flex: 1;
  }
</style>
