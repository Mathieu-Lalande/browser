<script lang="ts">
  import { t } from "@shared/i18n";
  import type { ArchivedTab } from "@shared/archive";
  import { displayUrl } from "@shared/url";
  import { api } from "../../../lib/browser.svelte";
  import Button from "../../ui/Button.svelte";
  import Favicon from "../../Favicon.svelte";
  import type { WidgetProps } from "../types";

  let { widget }: WidgetProps<"resume"> = $props();
  let archived = $state<ArchivedTab[]>([]);

  $effect(() => {
    const load = () => api.archive.list().then((list) => (archived = list), () => {});
    void load();
    return api.archive.onChanged(load);
  });

  const recent = $derived(archived.slice(0, widget.options.count));
</script>

<h2 class="widget-title">{t("resumeWidget.resume")}</h2>
<Button size="sm" icon="undo" onclick={() => api.commands.run("reopen-closed-tab")}>{t("resumeWidget.reopenClosedTab")}</Button>
{#if recent.length}
  <ul aria-label={t("resumeWidget.recentlyArchivedTabs")}>
    {#each recent as tab (tab.id)}
      <li>
        <button title={tab.url} onclick={() => api.archive.restore(tab.id)}>
          <Favicon src={tab.favicon} />
          <span>{tab.title || displayUrl(tab.url)}</span>
        </button>
      </li>
    {/each}
  </ul>
{:else}
  <p class="widget-empty">{t("resumeWidget.archivedInactiveTabsWill")}</p>
{/if}

<style>
  ul {
    display: grid;
    gap: 1px;
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }
  button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: var(--text-sm);
    text-align: left;
  }
  button:hover {
    background: var(--surface-hover);
  }
  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
