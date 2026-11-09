<script lang="ts">
  import { t } from "@shared/i18n";
  import { PANEL_SUGGESTIONS, panelUrlFromInput, samePanelUrl } from "@shared/panels";
  import { browser } from "../../lib/browser.svelte";
  import { panelsUi } from "../../lib/panels.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Checkbox from "../ui/Checkbox.svelte";
  import IconButton from "../ui/IconButton.svelte";

  /**
   * "Ajouter un panneau web" (ADR-047), drawn in the panel area beside the page: a typed address,
   * the current page, or a suggestion. Only web pages (http/https) can become a panel.
   */
  let draft = $state("");
  let mobile = $state(false);
  let message = $state<string | null>(null);
  let busy = $state(false);
  let field: HTMLInputElement;

  $effect(() => field?.focus());

  const current = $derived(browser.activeTab && /^https?:/.test(browser.activeTab.url) ? browser.activeTab : null);
  const suggestions = $derived(PANEL_SUGGESTIONS.filter((item) => !panelsUi.list.some((panel) => samePanelUrl(panel.url, item.url))));

  async function add(url: string, title?: string, asMobile = mobile): Promise<void> {
    if (busy) return;
    busy = true;
    message = await panelsUi.add(url, title, asMobile);
    busy = false;
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const url = panelUrlFromInput(draft);
    if (!url) message = t("panelAddForm.enterWebsiteAddressExample");
    else void add(url);
  }
</script>

<aside class="add-panel" aria-label={t("panelAddForm.addWebPanel")} data-testid="panel-add">
  <header>
    <Icon name="panel-right" size={16} />
    <h2>{t("panelAddForm.addWebPanel")}</h2>
    <IconButton size="sm" icon="close" iconSize={14} label={t("panelAddForm.cancel")} onclick={() => (panelsUi.adding = false)} />
  </header>
  <p class="hint">{t("panelAddForm.siteOpensNextPage")}</p>
  <form onsubmit={submit}>
    <input bind:this={field} class="ui-field" bind:value={draft} placeholder="web.whatsapp.com" aria-label={t("panelAddForm.panelAddress")} spellcheck="false" />
    <Button type="submit" variant="primary" disabled={busy || !draft.trim()}>{t("panelAddForm.add")}</Button>
  </form>
  <!-- Outside the form: the checkbox is a button, which would submit it. -->
  <Checkbox checked={mobile} onchange={(value) => (mobile = value)}>{t("panelAddForm.mobileSiteNarrowLayout")}</Checkbox>
  {#if current}
    <Button variant="quiet" icon="plus" disabled={busy} onclick={() => add(current.url, current.title)}>{t("panelAddForm.addCurrentPage")}</Button>
  {/if}
  {#if message}<p class="message" role="alert"><Icon name="warning" size={13} /> {message}</p>{/if}
  {#if suggestions.length}
    <h3>{t("panelAddForm.suggestions")}</h3>
    <ul class="suggestions">
      {#each suggestions as item (item.url)}
        <li><button type="button" class="suggestion" disabled={busy} onclick={() => add(item.url, item.title, item.mobile)}>{item.title}</button></li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .add-panel {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-3);
    width: 300px;
    padding: var(--space-3);
    overflow-y: auto;
    border-radius: var(--page-radius, var(--radius-md));
    background: var(--bg-elevated);
    box-shadow: var(--viewport-shadow);
    animation: rise var(--motion-base) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
  }
  h3 {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .hint,
  .message {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .message {
    color: var(--danger-text);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .suggestions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .suggestion {
    width: 100%;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
  }
  .suggestion:hover:not(:disabled) {
    background: var(--surface-hover);
  }
</style>
