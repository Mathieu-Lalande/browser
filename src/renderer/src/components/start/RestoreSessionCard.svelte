<script lang="ts">
  import { t } from "@shared/i18n";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Checkbox from "../ui/Checkbox.svelte";

  /**
   * "Restaurer la session ?" (ADR-042): after an unclean shutdown, the start page offers the
   * previous windows instead of reopening them by itself. Restore all, choose windows, or ignore.
   */

  const summary = $derived(browser.isPrivate ? null : (browser.state.recovery ?? null));
  let choosing = $state(false);
  let chosen = $state<Set<number>>(new Set());
  let busy = $state(false);

  $effect(() => {
    // Every window checked when the list opens.
    if (choosing && summary) chosen = new Set(summary.windows.map((window) => window.index));
  });

  function toggle(index: number, checked: boolean): void {
    const next = new Set(chosen);
    if (checked) next.add(index);
    else next.delete(index);
    chosen = next;
  }

  async function restore(indexes: number[] | null): Promise<void> {
    busy = true;
    await api.recovery.restore(indexes).catch(() => 0);
    busy = false;
  }

</script>

{#if summary}
  <section class="restore" aria-labelledby="restore-title" data-testid="restore-session">
    <div class="head">
      <span class="badge"><Icon name="reset" size={18} /></span>
      <div class="text">
        <h2 id="restore-title">{t("restoreSessionCard.restoreSession")}</h2>
        <p>
          {t("restoreSessionCard.notClosedProperly", { windows: summary.windows.length, tabs: summary.tabCount })}
        </p>
      </div>
    </div>
    {#if choosing}
      <ul class="windows">
        {#each summary.windows as window (window.index)}
          <li>
            <Checkbox checked={chosen.has(window.index)} onchange={(checked) => toggle(window.index, checked)}>
              {t("restoreSessionCard.windowTabs", { index: window.index + 1, tabs: window.tabCount })}
            </Checkbox>
            <span class="titles">{window.titles.join(" · ")}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="actions">
      {#if choosing}
        <Button size="sm" variant="primary" disabled={busy || chosen.size === 0} onclick={() => restore([...chosen])}>{t("restoreSessionCard.restoreSelection")}</Button>
        <Button size="sm" variant="quiet" onclick={() => (choosing = false)}>{t("restoreSessionCard.back")}</Button>
      {:else}
        <Button size="sm" variant="primary" icon="reset" disabled={busy} onclick={() => restore(null)}>{t("restoreSessionCard.restoreAll")}</Button>
        {#if summary.windows.length > 1}
          <Button size="sm" onclick={() => (choosing = true)}>{t("restoreSessionCard.chooseWindows")}</Button>
        {/if}
      {/if}
      <Button size="sm" variant="quiet" onclick={() => api.recovery.dismiss()}>{t("restoreSessionCard.ignore")}</Button>
    </div>
  </section>
{/if}

<style>
  .restore {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-self: center;
    width: min(640px, 100%);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    font-size: var(--text-sm);
  }
  .head {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
  }
  .badge {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--accent-text);
  }
  h2 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-md);
  }
  p {
    margin: 0;
    color: var(--text-muted);
  }
  .windows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .windows li {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .titles {
    padding-left: 28px;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
