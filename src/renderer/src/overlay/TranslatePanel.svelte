<script lang="ts">
  import { LANGUAGES, languageName, providerLabel, type TranslatePanelState } from "@shared/translate";
  import type { Bounds, TabId } from "@shared/types";
  import { api, browser } from "../lib/browser.svelte";
  import { dismiss } from "../components/ui/dismiss";
  import Icon from "../components/Icon.svelte";
  import Button from "../components/ui/Button.svelte";
  import Checkbox from "../components/ui/Checkbox.svelte";

  /**
   * The translate popover of the overlay layer (ADR-036): languages, translate / show the original,
   * the rules, and the privacy notice before anything leaves the device (once, or once per private
   * window). Main does the work; this page only names the tab and languages.
   */
  let { anchor, tabId, onClose }: { anchor?: Bounds; tabId: TabId; onClose: (restoreFocus: boolean) => void } = $props();

  const WIDTH = 340;
  const MARGIN = 8;

  let panel = $state<HTMLElement>();
  let innerWidth = $state(window.innerWidth);
  let innerHeight = $state(window.innerHeight);
  let info = $state<TranslatePanelState | null>(null);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** "" = detected by the provider. */
  let from = $state("");
  let to = $state("fr");

  const tab = $derived(browser.state.tabs.find((entry) => entry.id === tabId));
  /** Live status (the tab's state follows the run), else what the panel loaded. */
  const translation = $derived(tab?.translation ?? info?.translation ?? null);
  const status = $derived(translation?.status ?? "idle");
  const sourceName = $derived(languageName(translation?.pageLanguage ?? translation?.from ?? null));
  const ruleLanguage = $derived(translation?.pageLanguage ?? translation?.from ?? null);

  const position = $derived.by(() => {
    const box = anchor ?? { x: MARGIN, y: MARGIN, width: 0, height: 0 };
    const top = Math.max(MARGIN, box.y + box.height + 6);
    const left = Math.max(MARGIN, Math.min(box.x + box.width - WIDTH + 6, innerWidth - WIDTH - MARGIN));
    return { left, top, maxHeight: Math.max(200, innerHeight - top - MARGIN) };
  });

  $effect(() => {
    void api.translate
      .panel(tabId)
      .then((next) => {
        info = next;
        if (next) {
          from = next.translation.pageLanguage ?? "";
          to = next.translation.to;
        }
      }, () => null)
      .finally(() => (loaded = true));
  });
  $effect(() => panel?.focus());

  async function translate(): Promise<void> {
    if (!info || busy) return;
    busy = true;
    error = null;
    const consent = info.needsConsent;
    // Resolves once the first batch is in the page: the rest goes on in main, progressively.
    const result = await api.translate.run(tabId, from || null, to, consent).catch(() => ({ ok: false as const, message: "La traduction a échoué." }));
    busy = false;
    if (result.ok) onClose(false);
    else error = result.message;
  }

  function showOriginal(): void {
    api.translate.restore(tabId);
    onClose(false);
  }

  async function setRule(rule: "always-language" | "never-site", on: boolean): Promise<void> {
    const next = await api.translate.setRule(tabId, rule, on).catch(() => null);
    if (next) info = next;
  }

  function openSettings(): void {
    api.omnibox.open("browser://settings#translate", "new");
    onClose(false);
  }

</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div
  bind:this={panel}
  use:dismiss={{ onDismiss: () => onClose(true) }}
  class="panel"
  role="dialog"
  aria-label="Traduction de la page"
  tabindex="-1"
  data-testid="translate-panel"
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:max-height="{position.maxHeight}px"
  style:width="{Math.min(WIDTH, innerWidth - 2 * MARGIN)}px"
>
  {#if info}
    <header>
      <span class="badge"><Icon name="languages" size={16} /></span>
      <h2>
        {#if status === "translated"}Page traduite de {sourceName} vers {languageName(translation?.to)}
        {:else if status === "translating"}Traduction en cours…
        {:else}Traduire cette page ?{/if}
      </h2>
    </header>

    {#if info.provider === "none" || !info.configured}
      <p class="hint">
        {info.provider === "none"
          ? "La traduction est désactivée. Choisissez un service (DeepL, LibreTranslate ou Google) dans les paramètres."
          : "Le service choisi n'est pas encore configuré (clé d'API ou adresse du serveur)."}
      </p>
      <div class="buttons">
        <Button size="sm" variant="primary" icon="settings" onclick={openSettings}>Paramètres de traduction</Button>
      </div>
    {:else}
      <div class="languages">
        <label>
          <span>De</span>
          <select class="ui-field" bind:value={from} aria-label="Langue de la page">
            <option value="">Détecter{translation?.from && !translation.pageLanguage ? ` (${languageName(translation.from)})` : ""}</option>
            {#each LANGUAGES as language (language.code)}
              <option value={language.code}>{language.name}</option>
            {/each}
          </select>
        </label>
        <Icon name="forward" size={14} />
        <label>
          <span>Vers</span>
          <select class="ui-field" bind:value={to} aria-label="Langue de traduction">
            {#each LANGUAGES as language (language.code)}
              <option value={language.code}>{language.name}</option>
            {/each}
          </select>
        </label>
      </div>

      {#if info.needsConsent}
        <p class="notice" role="note">
          <Icon name="info" size={14} />
          <span>
            Le texte de cette page sera envoyé à {providerLabel(info.provider)} pour être traduit.
            {info.isPrivate ? "Fenêtre privée : confirmation demandée une fois par fenêtre, rien n'est enregistré." : ""}
          </span>
        </p>
      {/if}

      <div class="rules">
        <Checkbox checked={info.alwaysLanguage} onchange={(on) => setRule("always-language", on)}>
          {ruleLanguage ? `Toujours traduire : ${languageName(ruleLanguage)}` : "Toujours traduire cette langue"}
        </Checkbox>
        {#if info.site}
          <Checkbox checked={info.neverSite} onchange={(on) => setRule("never-site", on)}>Jamais pour {info.site}</Checkbox>
        {/if}
      </div>

      {#if error || translation?.error}<p class="error" role="alert"><Icon name="warning" size={12} /> {error ?? translation?.error}</p>{/if}

      <div class="buttons">
        {#if status === "translated" || status === "translating"}
          <Button size="sm" variant="ghost" onclick={showOriginal}>Afficher l'original</Button>
        {/if}
        <Button size="sm" variant="primary" disabled={busy} onclick={translate}>
          {info.needsConsent ? "Envoyer et traduire" : status === "translated" ? "Traduire de nouveau" : "Traduire"}
        </Button>
      </div>
    {/if}
  {:else if loaded}
    <p class="hint">Cette page ne peut pas être traduite.</p>
  {/if}
</div>

<style>
  .panel {
    position: fixed;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    overflow: auto;
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55),
      0 4px 14px -6px rgb(0 0 0 / 0.35);
    outline: none;
    animation: pop var(--motion-fast) var(--ease);
    transform-origin: top right;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: var(--accent-text);
  }
  h2 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.35;
  }
  p {
    margin: 0;
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .languages {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    color: var(--text-muted);
  }
  .languages label {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    font-size: var(--text-xs);
  }
  .languages :global(svg) {
    flex: none;
    margin-bottom: var(--space-2);
  }
  .languages select {
    width: 100%;
  }
  .notice {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.45;
  }
  .notice :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--accent-text);
  }
  .rules {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }
  .error {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--danger);
    font-size: var(--text-xs);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.97) translateY(-4px);
    }
  }
</style>
