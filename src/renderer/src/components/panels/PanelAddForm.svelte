<script lang="ts">
  import { t } from "@shared/i18n";
  import { PANEL_CATEGORIES, PANEL_SUGGESTIONS, panelUrlFromInput, samePanelUrl, type PanelCategory } from "@shared/panels";
  import { browser } from "../../lib/browser.svelte";
  import { panelsUi } from "../../lib/panels.svelte";
  import Icon, { type IconName } from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Checkbox from "../ui/Checkbox.svelte";
  import IconButton from "../ui/IconButton.svelte";

  /**
   * "Ajouter un panneau web" (ADR-047, ADR-059), drawn in the panel area beside the page: a typed
   * address (it also filters the catalog), the current page, or a site of the catalog, by
   * category. Only web pages (http/https) can become a panel.
   */
  let draft = $state("");
  let mobile = $state(false);
  let message = $state<string | null>(null);
  let busy = $state(false);
  let field: HTMLInputElement;

  $effect(() => field?.focus());

  const CATEGORY_ICONS: Record<PanelCategory, IconName> = { chat: "send", music: "music", ai: "sparkles", work: "briefcase", social: "users" };

  const current = $derived(browser.activeTab && /^https?:/.test(browser.activeTab.url) ? browser.activeTab : null);
  const query = $derived(draft.trim().toLowerCase());
  const available = $derived(
    PANEL_SUGGESTIONS.filter(
      (item) => !panelsUi.list.some((panel) => samePanelUrl(panel.url, item.url)) && (!query || item.title.toLowerCase().includes(query) || item.url.includes(query)),
    ),
  );
  const sections = $derived(PANEL_CATEGORIES.map((category) => ({ category, items: available.filter((item) => item.category === category) })).filter((section) => section.items.length));

  async function add(url: string, title?: string, asMobile = mobile): Promise<void> {
    if (busy) return;
    busy = true;
    message = await panelsUi.add(url, title, asMobile);
    busy = false;
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const url = panelUrlFromInput(draft);
    // A word that names a site of the catalog adds it.
    if (!url && available.length === 1) return void add(available[0].url, available[0].title, available[0].mobile);
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
  <p class="hint">{t("panelAddForm.subtitle")}</p>
  <form onsubmit={submit}>
    <div class="field">
      <Icon name="search" size={14} />
      <input bind:this={field} bind:value={draft} placeholder="web.whatsapp.com" aria-label={t("panelAddForm.panelAddress")} spellcheck="false" />
    </div>
    <Button type="submit" variant="primary" disabled={busy || !draft.trim()}>{t("panelAddForm.add")}</Button>
  </form>
  <!-- Outside the form: the checkbox is a button, which would submit it. -->
  <Checkbox checked={mobile} onchange={(value) => (mobile = value)}>{t("panelAddForm.mobileSiteNarrowLayout")}</Checkbox>
  {#if current}
    <Button variant="quiet" icon="plus" disabled={busy} onclick={() => add(current.url, current.title)}>{t("panelAddForm.addCurrentPage")}</Button>
  {/if}
  {#if message}<p class="message" role="alert"><Icon name="warning" size={13} /> {message}</p>{/if}
  {#each sections as section (section.category)}
    <section>
      <h3><Icon name={CATEGORY_ICONS[section.category]} size={12} /> {t(`panelAddForm.category.${section.category}`)}</h3>
      <ul class="tiles">
        {#each section.items as item (item.url)}
          <li>
            <button type="button" class="tile" disabled={busy} onclick={() => add(item.url, item.title, item.mobile)}>
              <span class="logo" aria-hidden="true">{item.title.charAt(0)}</span>
              <span class="name">{item.title}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</aside>

<style>
  .add-panel {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-3);
    width: 320px;
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
    color: var(--accent-text);
  }
  h2 {
    flex: 1;
    margin: 0;
    color: var(--text);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .hint,
  .message {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.45;
  }
  .message {
    color: var(--danger-text);
  }
  form {
    display: flex;
    gap: var(--space-2);
  }
  .field {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    height: var(--field-height, 32px);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-faint);
  }
  .field:focus-within {
    border-color: var(--accent);
  }
  .field input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: inherit;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* Like the start page's shortcuts: a quiet tile, its letter in the accent color. */
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-2) var(--space-1);
    border-radius: var(--radius-md);
    color: var(--text);
    transition: background var(--motion-fast) var(--ease);
  }
  .tile:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .logo {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--accent-text);
    font-size: var(--text-sm);
    font-weight: 700;
  }
  .tile:hover:not(:disabled) .logo {
    border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
  }
  .name {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .tile:hover:not(:disabled) .name {
    color: var(--text);
  }
</style>
