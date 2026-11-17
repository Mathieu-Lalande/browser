<script lang="ts">
  import { formatDate, t } from "@shared/i18n";
  import type { SavedSessionSummary } from "@shared/saved-sessions";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Page from "../ui/Page.svelte";

  /**
   * `browser://sessions` (ADR-059): the pages of the space shown, kept under a name, and opened
   * again later in a folder of that name. Nothing of this in a private window.
   */
  let sessions = $state<SavedSessionSummary[]>([]);
  let name = $state("");
  let message = $state<string | null>(null);

  const webTabs = $derived(browser.state.tabs.filter((tab) => /^https?:/.test(tab.url)).length);

  $effect(() => {
    if (!browser.isPrivate) void api.sessions.list().then((list) => (sessions = list));
  });

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const next = await api.sessions.save(name);
    if (next) {
      sessions = next;
      name = "";
      message = null;
    } else message = t("sessionsPage.nothingToSave");
  }

  // A pleasant, stable color per session.
  const hue = (id: string) => [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
</script>

<Page icon="layers" title={t("sessionsPage.title")} subtitle={t("sessionsPage.subtitle")} testid="sessions-page">
  {#if browser.isPrivate}
    <EmptyState icon="mask" title={t("sessionsPage.privateTitle")} hint={t("sessionsPage.privateHint")} />
  {:else}
    <form class="save" onsubmit={save}>
      <input class="ui-field" bind:value={name} maxlength="60" placeholder={t("sessionsPage.namePlaceholder")} aria-label={t("sessionsPage.name")} />
      <Button type="submit" variant="primary" disabled={!name.trim() || !webTabs}>{t("sessionsPage.save", { count: webTabs })}</Button>
    </form>
    {#if message}<p class="hint" role="alert">{message}</p>{/if}

    {#if sessions.length}
      <ul class="grid">
        {#each sessions as session (session.id)}
          <li class="session" style:--hue={hue(session.id)}>
            <div class="top">
              <span class="dot"></span>
              <h2>{session.name}</h2>
              <ConfirmButton question={t("sessionsPage.deleteQuestion")} confirmLabel={t("sessionsPage.delete")} title={t("sessionsPage.delete")} onconfirm={async () => (sessions = await api.sessions.remove(session.id))}>
                <Icon name="trash" size={14} />
              </ConfirmButton>
            </div>
            <p class="meta">{t("sessionsPage.meta", { count: session.count, date: formatDate(session.createdAt) })}</p>
            <ul class="sites">
              {#each session.sites as site (site)}<li>{site}</li>{/each}
            </ul>
            <Button variant="secondary" icon="folder-open" onclick={() => api.sessions.open(session.id)}>{t("sessionsPage.open")}</Button>
          </li>
        {/each}
      </ul>
    {:else}
      <EmptyState icon="layers" title={t("sessionsPage.empty")} hint={t("sessionsPage.emptyHint")} />
    {/if}
  {/if}
</Page>

<style>
  .save {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid color-mix(in oklab, var(--accent) 30%, var(--border));
    border-radius: var(--radius-lg);
    background: linear-gradient(110deg, color-mix(in oklab, var(--accent) min(calc(14% * var(--tint, 1)), 90%), transparent), color-mix(in oklab, var(--accent-2) min(calc(10% * var(--tint, 1)), 90%), transparent)), var(--bg-elevated);
  }
  .save input {
    flex: 1 1 220px;
  }
  .hint {
    margin: 0;
    color: var(--danger-text);
    font-size: var(--text-xs);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .session {
    --c: oklch(68% 0.15 var(--hue));
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid color-mix(in oklab, var(--c) 30%, var(--border));
    border-radius: var(--radius-lg);
    background: radial-gradient(120% 90% at 0% 0%, color-mix(in oklab, var(--c) 16%, transparent), transparent 70%), var(--bg-elevated);
    transition: transform var(--motion-fast) var(--ease);
  }
  .session:hover {
    transform: translateY(-2px);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-pill);
    background: var(--c);
  }
  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: var(--text-md);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .meta {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .sites {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0 0 var(--space-1);
    padding: 0;
    list-style: none;
  }
  .sites li {
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: color-mix(in oklab, var(--c) 14%, transparent);
    font-size: var(--text-xs);
    line-height: 1.7;
  }
</style>
