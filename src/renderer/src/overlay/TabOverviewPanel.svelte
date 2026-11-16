<script lang="ts">
  import { t } from "@shared/i18n";
  import type { OmniboxTab } from "@shared/omnibox/types";
  import { api } from "../lib/browser.svelte";
  import Icon from "../components/Icon.svelte";

  let { onClose }: { onClose: (restoreFocus: boolean) => void } = $props();

  let tabs = $state<OmniboxTab[]>([]);
  let panel = $state<HTMLDivElement>();

  $effect(() => panel?.focus());

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    }
  }

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
    onClose(false);
  }
</script>

<div class="panel" role="dialog" aria-label={t("tabOverviewPanel.allTabs")} tabindex="-1" bind:this={panel} onkeydown={onKeydown}>
  <header>
    <div>
      <h1>{t("tabOverviewPanel.allTabs")}</h1>
      <p>{t("tabOverviewPanel.tabsAllSpaces", { tabsCount: tabs.length })}</p>
    </div>
    <button class="close" type="button" aria-label={t("tabOverviewPanel.close")} title={t("tabOverviewPanel.close")} onclick={() => onClose(true)}>
      <Icon name="close" size={18} />
    </button>
  </header>
  {#if tabs.length}
    <div class="list">
      {#each tabs as tab (tab.id)}
        <button class="tab" type="button" onclick={() => show(tab)}>
          {#if tab.favicon}<img src={tab.favicon} alt="" />{:else}<Icon name="globe" size={18} />{/if}
          <span class="text"><strong>{tab.title || tab.url}</strong><small>{tab.spaceName ?? t("tabOverviewPanel.currentSpace")}{tab.url ? ` · ${tab.url}` : ""}</small></span>
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
    width: min(680px, calc(100vw - 2 * var(--space-5)));
    max-height: min(720px, calc(100vh - 2 * var(--space-5)));
    margin: var(--space-5) auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: 0 24px 70px rgb(0 0 0 / 0.35);
    outline: none;
  }
  header { display: flex; justify-content: space-between; align-items: start; gap: var(--space-3); padding: var(--space-5) var(--space-5) var(--space-4); border-bottom: 1px solid var(--border); }
  h1 { margin: 0; font-size: var(--text-lg); }
  p { margin: var(--space-1) 0 0; color: var(--text-muted); font-size: var(--text-sm); }
  button { font: inherit; color: inherit; }
  .close { display: grid; flex: none; place-items: center; width: var(--hit-min); height: var(--hit-min); border: 0; border-radius: var(--radius-sm); background: transparent; cursor: pointer; transition: background var(--motion-fast) var(--ease); }
  .close:hover { background: var(--bg-hover); }
  .list { overflow: auto; padding: var(--space-2); }
  .tab { display: flex; align-items: center; gap: var(--space-3); width: 100%; padding: var(--space-3); border: 0; border-radius: var(--radius-md); background: transparent; text-align: left; cursor: pointer; }
  .tab:hover, .tab:focus-visible { background: var(--bg-hover); }
  .tab img { width: 18px; height: 18px; object-fit: contain; }
  .text { display: grid; min-width: 0; flex: 1; gap: 2px; }
  strong, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { font-size: var(--text-md); font-weight: 600; }
  small { color: var(--text-muted); font-size: var(--text-xs); }
  .empty { padding: var(--space-5); }
</style>
