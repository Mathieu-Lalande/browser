<script lang="ts">
  import type { ResolvedMode } from "@shared/theme";
  import {
    THEME_GALLERY,
    applyTheme,
    encodeTheme,
    isCurrentTheme,
    parseThemeInput,
    themeFromSettings,
    themePatch,
    type SharedTheme,
  } from "@shared/theme-share";
  import { api } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import MiniBrowser from "./MiniBrowser.svelte";
  import QrCode from "./QrCode.svelte";
  import Row from "../ui/Row.svelte";
  import Button from "../ui/Button.svelte";

  /** Theme gallery, export (code, file, QR) and import with a preview (ADR-030). */

  const s = $derived(settings.current);
  const code = $derived(encodeTheme(themeFromSettings(s)));
  let showQr = $state(false);
  let copied = $state(false);
  let exported = $state(false);
  let draft = $state("");
  let error = $state<string | null>(null);
  let pending = $state<SharedTheme | null>(null);

  const modeOf = (theme: SharedTheme): ResolvedMode =>
    theme.mode === "system" ? (settings.systemDark ? "dark" : "light") : theme.mode;

  function apply(theme: SharedTheme): void {
    settings.update(themePatch(theme, settings.current));
  }

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(code).then(() => (copied = true), () => {});
    setTimeout(() => (copied = false), 2000);
  }

  async function exportFile(): Promise<void> {
    exported = await api.theme.exportFile(themeFromSettings(settings.current)).catch(() => false);
    setTimeout(() => (exported = false), 2000);
  }

  function preview(text: string): void {
    const result = parseThemeInput(text);
    pending = result.ok ? result.theme : null;
    error = result.ok ? null : result.error;
  }

  async function importFile(): Promise<void> {
    const result = await api.theme.importFile().catch(() => ({ ok: false as const, error: "Le fichier n'a pas pu être lu." }));
    if (!result) return;
    pending = result.ok ? result.theme : null;
    error = result.ok ? null : result.error;
  }

  function confirm(): void {
    if (pending) apply(pending);
    cancel();
  }

  function cancel(): void {
    pending = null;
    error = null;
    draft = "";
  }
</script>

<Row label="Thèmes" hint="Une sélection de thèmes prêts à l'emploi : couleurs, police, densité et arrondi." stacked>
  <div class="gallery" role="group" aria-label="Galerie de thèmes">
    {#each THEME_GALLERY as theme (theme.name)}
      <button class="card" aria-pressed={isCurrentTheme(s, theme)} onclick={() => apply(theme)}>
        <span class="frame"><MiniBrowser settings={applyTheme(s, theme)} mode={modeOf(theme)} /></span>
        <span class="caption">
          {#if isCurrentTheme(s, theme)}<Icon name="check" size={12} />{/if}
          {theme.name}
        </span>
      </button>
    {/each}
  </div>
</Row>

<Row label="Partager le thème" hint="Un code à coller dans Browser, sur ordinateur ou sur téléphone. Aucune image ni adresse n'est incluse." stacked>
  <div class="share">
    <input class="ui-field code" readonly value={code} aria-label="Code du thème" spellcheck="false" onfocus={(event) => event.currentTarget.select()} />
    <div class="buttons">
      <Button icon={copied ? "check" : "copy-text"} onclick={copy}>{copied ? "Copié" : "Copier le code"}</Button>
      <Button icon={exported ? "check" : "file-down"} onclick={exportFile}>{exported ? "Exporté" : "Exporter un fichier…"}</Button>
      <Button icon="qr" aria-pressed={showQr} onclick={() => (showQr = !showQr)}>QR code</Button>
    </div>
    {#if showQr}
      <QrCode value={code} size={176} label="QR code du thème" />
    {/if}
  </div>
</Row>

<Row label="Importer un thème" hint="Collez un code de thème, ou choisissez un fichier .browsertheme." stacked>
  <div class="share">
    <div class="buttons">
      <input
        class="ui-field code"
        value={draft}
        placeholder="browser-theme:v1:…"
        aria-label="Code de thème à importer"
        spellcheck="false"
        autocomplete="off"
        oninput={(event) => ((draft = event.currentTarget.value), (error = null))}
        onkeydown={(event) => event.key === "Enter" && preview(draft)}
      />
      <Button icon="paste" disabled={!draft.trim()} onclick={() => preview(draft)}>Aperçu</Button>
      <Button icon="file-up" onclick={importFile}>Depuis un fichier…</Button>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if pending}
      <div class="preview" role="group" aria-label="Aperçu du thème importé">
        <span class="frame large"><MiniBrowser settings={applyTheme(s, pending)} mode={modeOf(pending)} /></span>
        <div class="preview-text">
          <strong>{pending.name || "Thème importé"}</strong>
          <span class="swatches">
            <i style:background={pending.accent}></i><i style:background={pending.accent2}></i>
          </span>
          <div class="buttons">
            <Button variant="primary" icon="check" onclick={confirm}>Appliquer</Button>
            <Button onclick={cancel}>Annuler</Button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</Row>

<style>
  /* The gallery is a full-width grid under its label: as many cards per line as fit. */
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-3);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    text-align: left;
    transition:
      background var(--motion-fast) var(--ease),
      border-color var(--motion-fast) var(--ease),
      transform var(--motion-fast) var(--ease);
  }
  .card:hover {
    border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
    background: var(--surface-hover);
  }
  .card:active {
    transform: scale(0.98);
  }
  .card[aria-pressed="true"] {
    border-color: var(--accent-text);
    box-shadow: 0 0 0 1px var(--accent-text);
  }
  .frame {
    display: block;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: var(--radius-sm);
  }
  .frame.large {
    width: 180px;
    height: 100px;
    flex: none;
  }
  .caption {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px 2px;
    font-size: var(--text-xs);
    font-weight: 500;
  }
  .card[aria-pressed="true"] .caption {
    color: var(--accent-text);
  }
  .share {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .share > .code {
    flex: none;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .code {
    flex: 1 1 220px;
    width: 100%;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .preview {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .preview-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .swatches {
    display: flex;
    gap: var(--space-1);
  }
  .swatches i {
    width: 16px;
    height: 16px;
    border: 1px solid var(--border);
    border-radius: 50%;
  }
  .error {
    margin: 0;
    color: var(--danger-text);
    font-size: var(--text-xs);
  }
</style>
