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
    <input class="field code" readonly value={code} aria-label="Code du thème" spellcheck="false" onfocus={(event) => event.currentTarget.select()} />
    <div class="buttons">
      <button class="secondary" onclick={copy}><Icon name={copied ? "check" : "copy-text"} size={12} /> {copied ? "Copié" : "Copier le code"}</button>
      <button class="secondary" onclick={exportFile}><Icon name={exported ? "check" : "file-down"} size={12} /> {exported ? "Exporté" : "Exporter un fichier…"}</button>
      <button class="secondary" aria-pressed={showQr} onclick={() => (showQr = !showQr)}><Icon name="qr" size={12} /> QR code</button>
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
        class="field code"
        value={draft}
        placeholder="browser-theme:v1:…"
        aria-label="Code de thème à importer"
        spellcheck="false"
        autocomplete="off"
        oninput={(event) => ((draft = event.currentTarget.value), (error = null))}
        onkeydown={(event) => event.key === "Enter" && preview(draft)}
      />
      <button class="secondary" disabled={!draft.trim()} onclick={() => preview(draft)}><Icon name="paste" size={12} /> Aperçu</button>
      <button class="secondary" onclick={importFile}><Icon name="file-up" size={12} /> Depuis un fichier…</button>
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
            <button class="primary" onclick={confirm}><Icon name="check" size={12} /> Appliquer</button>
            <button class="secondary" onclick={cancel}>Annuler</button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</Row>

<style>
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    text-align: left;
  }
  .card:hover {
    background: var(--surface-hover);
  }
  .card[aria-pressed="true"] {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .frame {
    display: block;
    height: 64px;
    overflow: hidden;
    border-radius: 6px;
  }
  .frame.large {
    width: 180px;
    height: 100px;
    flex: none;
  }
  .caption {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
  }
  .share {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .field {
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    outline: 0;
    background: var(--surface);
    user-select: text;
  }
  .field:focus {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
  }
  .code {
    flex: 1 1 220px;
    min-width: 0;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .preview {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .preview-text {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .swatches {
    display: flex;
    gap: 4px;
  }
  .swatches i {
    width: 16px;
    height: 16px;
    border: 1px solid var(--border);
    border-radius: 50%;
  }
  .error {
    margin: 0;
    color: var(--danger, #c62828);
    font-size: 12px;
  }
  .primary,
  .secondary {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    white-space: nowrap;
  }
  .primary {
    border-color: transparent;
    background: var(--accent);
    color: var(--on-accent);
  }
  .secondary:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .secondary:disabled {
    opacity: 0.5;
  }
</style>
