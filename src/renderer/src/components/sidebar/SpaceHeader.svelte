<script lang="ts">
  import { t } from "@shared/i18n";
  import type { SpaceInfo, TabState } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { pinnedPlace } from "@shared/pinned-home";
  import { api } from "../../lib/browser.svelte";
  import { platform } from "../../lib/platform.svelte";
  import { previewsEnabled, tabPreview } from "../../lib/tab-preview";
  import Icon from "../Icon.svelte";
  import TabIcon from "../TabIcon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import { tabTidy } from "../../lib/tab-tidy.svelte";

  /**
   * Top of a space's tab area: its title (when given), the pinned tabs, and the "Nouvel onglet" row.
   * `preview`: the same, inert (a neighbour space beside the shown one during a swipe).
   */
  let {
    space,
    pinned,
    activeId,
    preview = false,
    onEdit,
    onNewTab,
  }: {
    space?: SpaceInfo;
    pinned: TabState[];
    activeId: string | null;
    preview?: boolean;
    onEdit?: () => void;
    onNewTab?: () => void;
  } = $props();

  const tooltip = (tab: TabState) =>
    previewsEnabled() ? undefined : tab.url && tab.url !== tab.title ? `${tab.title}\n${displayUrl(tab.url)}` : tab.title;
</script>

{#if space}
  <div class="space-title" style:--dot={space.color ?? "var(--accent)"}>
    <span class="space-icon"><Icon name={space.icon} size={16} /></span>
    <span class="space-name">{space.name}</span>
    {#if space.isolated}<span class="badge" title={preview ? undefined : t("spaceHeader.separateCookiesSignIns")}>{t("spaceHeader.isolated")}</span>{/if}
    {#if preview}
      <IconButton as="span" size="sm" icon="more" label="" />
    {:else}
      <IconButton size="sm" icon="more" label={t("spaceHeader.editSpace")} onclick={onEdit} />
    {/if}
  </div>
{/if}

{#if pinned.length}
  {#if preview}
    <div class="pinned">
      {#each pinned as item (item.id)}
        <div class="pinned-tab" class:active={item.id === activeId}><TabIcon tab={item} /></div>
      {/each}
    </div>
  {:else}
    <div class="pinned" role="tablist" aria-label={t("spaceHeader.pinnedTabs")}>
      {#each pinned as item (item.id)}
        <button
          class="pinned-tab"
          class:active={item.id === activeId}
          class:asleep={item.isAsleep}
          class:away={!!item.pinnedUrl && pinnedPlace(item.pinnedUrl, item.url) !== "home"}
          role="tab"
          aria-selected={item.id === activeId}
          aria-label={item.title}
          title={tooltip(item)}
          use:tabPreview={{ kind: "tab", id: item.id }}
          onclick={() => api.tabs.activate(item.id)}
          ondblclick={() => api.tabs.togglePin(item.id)}
          oncontextmenu={(event) => (event.preventDefault(), api.tabs.contextMenu(item.id))}
        >
          <TabIcon tab={item} />
          {#if item.pinnedUrl && pinnedPlace(item.pinnedUrl, item.url) !== "home"}<span class="away-dot" title={t("sidebar.pinnedAway")}></span>{/if}
        </button>
      {/each}
    </div>
  {/if}
{/if}

<div class="divider"></div>

<div class="new-row">
  {#if preview}
    <div class="new-tab"><Icon name="plus" size={16} /> <span class="label">{t("spaceHeader.newTab")}</span></div>
    <IconButton as="span" size="sm" icon="sparkles" label="" />
    <IconButton as="span" size="sm" icon="folder-plus" label="" />
  {:else}
    <button class="new-tab" title={platform.tip(t("spaceHeader.newTab"), "new-tab")} onclick={onNewTab}>
      <Icon name="plus" size={16} /> <span class="label">{t("spaceHeader.newTab")}</span>
    </button>
    <IconButton size="sm" icon="sparkles" label={t("sharedCommands.tidyTabs")} command="tidy-tabs" onclick={() => void tabTidy.start()} />
    <IconButton size="sm" icon="folder-plus" label={t("spaceHeader.newFolder")} onclick={() => api.folders.create()} />
  {/if}
</div>

<style>
  .space-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 30px;
    margin-top: var(--space-1);
    padding: 0 2px 0 var(--space-2);
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
  /* Tiles share the row: few pinned tabs fill it, many wrap onto more rows. */
  .pinned {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(44px, 1fr));
    gap: 6px;
    margin-top: 6px;
  }
  .pinned-tab {
    position: relative;
    display: grid;
    place-items: center;
    height: 44px;
    border-radius: var(--radius);
    background: var(--surface);
  }
  .pinned-tab:hover {
    background: var(--surface-hover);
  }
  /* Away from its pinned page (ADR-059): a dot, a click on the address bar's chip brings it home. */
  .away-dot {
    position: absolute;
    right: var(--space-1);
    bottom: var(--space-1);
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--bg);
  }
  .pinned-tab.active {
    background: var(--bg-elevated);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) min(calc(45% * var(--tint, 1)), 90%), transparent);
  }
  /* Asleep (page unloaded, reloads on click): dimmed, like in the tab list. */
  .pinned-tab.asleep:not(.active) > :global(*) {
    opacity: 0.45;
    filter: grayscale(0.6);
  }
  .divider {
    height: 1px;
    margin: 6px var(--space-1);
    background: var(--border);
  }
  .new-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .new-tab {
    display: flex;
    flex: 1;
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
</style>
