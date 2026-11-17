<script lang="ts">
  import { t } from "@shared/i18n";
  import { api, browser } from "../../lib/browser.svelte";
  import { tabTidy } from "../../lib/tab-tidy.svelte";
  import { dismiss } from "../ui/dismiss";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import TabIcon from "../TabIcon.svelte";

  /**
   * "Ranger les onglets" (ADR-059): the proposed folders, above the tab tree. Each one can be
   * renamed or left out; "Créer" makes the folders kept. Nothing moved until then. When there is
   * nothing to propose, it says why and what would help (tabs already filed, the assistant).
   */
  const tabOf = (id: string) => browser.state.tabs.find((tab) => tab.id === id);
  const kept = $derived(tabTidy.groups.filter((group) => group.keep).length);
  const proposal = $derived(tabTidy.proposal);
  const subtitle = $derived(
    tabTidy.loading ? t("tabTidy.thinking") : proposal?.source === "ai" ? t("tabTidy.byTopic") : proposal?.scope === "all" ? t("tabTidy.localAll") : t("tabTidy.local"),
  );
  const openAssistantSettings = () => api.omnibox.open("browser://settings#assistant", "new");
</script>

{#if tabTidy.open}
  <section class="tidy" aria-label={t("tabTidy.title")} data-testid="tidy-panel" use:dismiss={{ onDismiss: () => tabTidy.close(), escape: "node" }}>
    <header>
      <Icon name="sparkles" size={16} />
      <span class="heading">
        <strong>{t("tabTidy.title")}</strong>
        <small>{subtitle}</small>
      </span>
      <IconButton size="sm" icon="close" iconSize={14} label={t("tabTidy.cancel")} onclick={() => tabTidy.close()} />
    </header>

    {#if tabTidy.loading}
      <div class="placeholder" aria-hidden="true"><span></span><span></span></div>
    {:else if tabTidy.groups.length}
      <ul class="groups">
        {#each tabTidy.groups as group, index (index)}
          <li class:off={!group.keep}>
            <div class="line">
              <input type="checkbox" bind:checked={group.keep} aria-label={t("tabTidy.keepGroup", { name: group.name })} />
              <input class="name" bind:value={group.name} aria-label={t("tabTidy.folderName")} maxlength="40" spellcheck="false" />
              <span class="count">{group.tabIds.length}</span>
            </div>
            <div class="icons">
              {#each group.tabIds.slice(0, 8) as id (id)}
                {@const tab = tabOf(id)}
                {#if tab}<span class="icon" title={tab.title}><TabIcon {tab} /></span>{/if}
              {/each}
            </div>
          </li>
        {/each}
      </ul>
      <div class="actions">
        <Button variant="quiet" size="sm" onclick={() => tabTidy.close()}>{t("tabTidy.cancel")}</Button>
        <Button variant="primary" size="sm" icon="folder-plus" disabled={!kept} onclick={() => tabTidy.apply()}>{t("tabTidy.apply", { count: kept })}</Button>
      </div>
    {:else if proposal}
      <p class="empty">
        {proposal.considered < 2 ? t("tabTidy.tooFewLoose", { count: proposal.considered }) : t("tabTidy.nothingInCommon")}
      </p>
    {/if}

    {#if !tabTidy.loading && proposal}
      {#if proposal.inFolders > 0}
        <Button variant="secondary" size="sm" icon="folder-open" onclick={() => tabTidy.start("all")}>{t("tabTidy.includeFiled", { count: proposal.inFolders })}</Button>
      {/if}
      {#if !proposal.assistantReady && !browser.isPrivate}
        <p class="hint">
          <Icon name="sparkles" size={12} />
          <span>{t("tabTidy.assistantHint")} <button type="button" class="link" onclick={openAssistantSettings}>{t("tabTidy.assistantLink")}</button></span>
        </p>
      {/if}
      {#if proposal.notice}<p class="hint">{proposal.notice}</p>{/if}
    {/if}
  </section>
{/if}

<style>
  .tidy {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: var(--space-1) 0 var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    box-shadow: var(--viewport-shadow);
    animation: rise var(--motion-base) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--accent-text);
  }
  .heading {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    color: var(--text);
    line-height: 1.3;
  }
  .heading strong {
    font-size: var(--text-sm);
    font-weight: 600;
  }
  small {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
    transition: opacity var(--motion-fast) var(--ease);
  }
  li.off {
    opacity: 0.5;
  }
  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  input[type="checkbox"] {
    flex: none;
    accent-color: var(--accent);
  }
  .name {
    flex: 1;
    min-width: 0;
    padding: 2px var(--space-1);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 600;
  }
  .name:hover,
  .name:focus {
    border-color: var(--border);
    background: var(--bg);
    outline: none;
  }
  .count {
    flex: none;
    min-width: 20px;
    padding: 0 var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--surface-hover);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-align: center;
  }
  .icons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: var(--space-1) 0 0 22px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .empty {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: 1.45;
  }
  .hint {
    display: flex;
    gap: var(--space-2);
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.45;
  }
  .hint :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--accent-text);
  }
  .link {
    padding: 0;
    color: var(--accent-text);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .placeholder {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .placeholder span {
    height: 32px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    animation: pulse calc(var(--motion-base) * 6) ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.5;
    }
  }
</style>
