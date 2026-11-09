<script lang="ts">
  import { t } from "@shared/i18n";
  import type { OmniboxTab } from "@shared/omnibox/types";
  import { api } from "../lib/browser.svelte";
  import Icon from "../components/Icon.svelte";

  let tabs = $state<OmniboxTab[]>([]);

  $effect(() => {
    let active = true;
    void api.omnibox.tabs().then((next) => {
      if (active) tabs = next;
    });
    return () => (active = false);
  });

  function show(tab: OmniboxTab): void {
    if (tab.spaceId) api.omnibox.showTab(tab.spaceId, tab.id);
    else api.tabs.activate(tab.id);
    api.overlay.close(false);
  }
</script>

<div class="panel" role="dialog" aria-label={t("tabOverviewPanel.allTabs")}>
  <header>
    <div>
      <h1>{t("tabOverviewPanel.allTabs")}</h1>
      <p>{t("tabOverviewPanel.tabsAllSpaces", { tabsCount: tabs.length })}</p>
    </div>
    <button class="close" type="button" aria-label={t("tabOverviewPanel.close")} title={t("tabOverviewPanel.close")} onclick={() => api.overlay.close(true)}>
      <Icon name="close" size={18} />
    </button>
  </header>
  {#if tabs.length}
    <div class="list">
      {#each tabs as tab (tab.id)}
        <button class="tab" type="button" onclick={() => show(tab)}>
          {#if tab.favicon}<img src={tab.favicon} alt="" />{:else}<Icon name="globe" size={18} />{/if}
          <span class="text"><strong>{tab.title || tab.url}</strong><small>{tab.spaceName ?? t("tabOverviewPanel.currentSpace")} · {tab.url}</small></span>
          <Icon name="arrow" size={16} />
        </button>
      {/each}
    </div>
  {:else}
    <p class="empty">{t("tabOverviewPanel.noOpenTabs")}</p>
  {/if}
</div>

<style>
  .panel {
    width: min(680px, calc(100vw - 48px));
    max-height: min(720px, calc(100vh - 48px));
    margin: 24px auto;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: 0 24px 70px rgb(0 0 0 / 0.35);
  }
  header { display: flex; justify-content: space-between; align-items: start; padding: 22px 24px 16px; border-bottom: 1px solid var(--border); }
  h1 { margin: 0; font-size: 20px; }
  p { margin: 5px 0 0; color: var(--text-muted); font-size: 13px; }
  button { font: inherit; color: inherit; }
  .close { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
  .close:hover { background: var(--bg-hover); }
  .list { overflow: auto; padding: 8px; }
  .tab { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; border: 0; border-radius: 10px; background: transparent; text-align: left; cursor: pointer; }
  .tab:hover, .tab:focus-visible { background: var(--bg-hover); outline: none; }
  .tab img { width: 18px; height: 18px; object-fit: contain; }
  .text { display: grid; min-width: 0; flex: 1; gap: 3px; }
  strong, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { font-size: 14px; }
  small { color: var(--text-muted); font-size: 12px; }
  .empty { padding: 24px; }
</style>
