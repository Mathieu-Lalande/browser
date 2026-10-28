<script lang="ts">
  import type { ExtensionInfo, ExtensionInstallResult } from "@shared/extensions";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import ConfirmButton from "../settings/ConfirmButton.svelte";
  import Toggle from "../settings/Toggle.svelte";

  /**
   * `browser://extensions` (ADR-024): installed extensions, to switch on/off, allow in private
   * windows or remove; installing asks main for a folder or a .zip/.crx through a file dialog.
   * A private window only lists them.
   */

  let extensions = $state<ExtensionInfo[]>([]);
  let loaded = $state(false);
  let busy = $state(false);
  let notice = $state<{ kind: "error" | "success"; text: string } | null>(null);
  let request = 0;

  async function refresh(): Promise<void> {
    const id = ++request;
    const list = await api.extensions.list().catch(() => []);
    if (id !== request) return;
    extensions = list;
    loaded = true;
  }

  $effect(() => {
    void refresh();
    return api.extensions.onChanged(() => void refresh());
  });

  async function install(kind: "folder" | "file"): Promise<void> {
    busy = true;
    notice = null;
    let result: ExtensionInstallResult;
    try {
      result = await (kind === "folder" ? api.extensions.installFromFolder() : api.extensions.installFromFile());
    } catch {
      result = { ok: false, message: "L'installation a échoué." };
    }
    busy = false;
    if (!result) return;
    notice = result.ok ? { kind: "success", text: `« ${result.extension.name} » est installée.` } : { kind: "error", text: result.message };
    void refresh();
  }
</script>

<div class="page" data-testid="extensions-page">
  <div class="inner">
    <header>
      <span class="badge"><Icon name="extension" size={20} /></span>
      <h1>Extensions</h1>
      {#if !browser.isPrivate}
        <div class="actions">
          <button class="action" disabled={busy} onclick={() => install("folder")} title="Extension non empaquetée (dossier contenant manifest.json)">
            <Icon name="folder-open" size={12} /> Charger un dossier
          </button>
          <button class="action" disabled={busy} onclick={() => install("file")} title="Archive .zip ou extension .crx">
            <Icon name="file-archive" size={12} /> Installer un fichier
          </button>
        </div>
      {/if}
    </header>

    <p class="intro">
      {#if browser.isPrivate}
        Les extensions se gèrent depuis une fenêtre normale. Elles ne s'appliquent pas aux fenêtres privées.
      {:else}
        Extensions Chrome (Manifest V2 ou V3) appliquées aux pages de tous vos espaces. Le navigateur prend en charge une partie des API
        d'extension : les scripts de contenu et la plupart des extensions simples fonctionnent, les boutons de barre d'outils ne sont pas
        encore affichés.
      {/if}
    </p>

    {#if notice}
      <p class="notice {notice.kind}" role={notice.kind === "error" ? "alert" : "status"}>
        <Icon name={notice.kind === "error" ? "warning" : "check"} size={14} />
        <span>{notice.text}</span>
        <button class="dismiss" aria-label="Fermer le message" onclick={() => (notice = null)}><Icon name="close" size={12} /></button>
      </p>
    {/if}

    {#if extensions.length}
      <ul class="card">
        {#each extensions as extension (extension.id)}
          <li class="row" class:disabled={!extension.enabled} data-extension-id={extension.id}>
            <span class="icon">
              {#if extension.icon}
                <img src={extension.icon} alt="" width="28" height="28" />
              {:else}
                <Icon name="extension" size={18} />
              {/if}
            </span>
            <span class="text">
              <span class="title">{extension.name} <span class="version">{extension.version}</span></span>
              {#if extension.description}<span class="detail">{extension.description}</span>{/if}
              <span class="detail">
                Manifest V{extension.manifestVersion} · {extension.managed ? "installée depuis un fichier" : "dossier non empaqueté"}
              </span>
              {#if extension.error}
                <span class="error"><Icon name="warning" size={12} /> {extension.error}</span>
              {/if}
              {#if !browser.isPrivate}
                <span class="private">
                  <Toggle
                    label={`Autoriser ${extension.name} en navigation privée`}
                    checked={extension.allowPrivate}
                    onchange={(allowed) => api.extensions.setPrivateAllowed(extension.id, allowed)}
                  />
                  <span class="private-label">
                    Autoriser en navigation privée
                    <span class="hint">Sans effet pour l'instant : Electron ne charge pas d'extension dans les sessions en mémoire des fenêtres privées.</span>
                  </span>
                </span>
              {/if}
            </span>
            {#if !browser.isPrivate}
              <Toggle
                label={`${extension.enabled ? "Désactiver" : "Activer"} ${extension.name}`}
                checked={extension.enabled}
                onchange={(enabled) => api.extensions.setEnabled(extension.id, enabled)}
              />
              <ConfirmButton question="Retirer cette extension ?" confirmLabel="Retirer" title={`Retirer ${extension.name}`} onconfirm={() => api.extensions.remove(extension.id)}>
                <Icon name="trash" size={12} /> Retirer
              </ConfirmButton>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if loaded}
      <div class="empty">
        <Icon name="extension" size={28} />
        <p>Aucune extension installée.</p>
        {#if !browser.isPrivate}
          <p class="detail">Chargez le dossier d'une extension (contenant manifest.json) ou installez une archive .zip ou .crx.</p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .page {
    height: 100%;
    overflow-y: auto;
    animation: rise 0.3s var(--ease);
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 760px;
    margin: 0 auto;
    padding: 36px 32px 64px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 11px;
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--accent-text);
  }
  h1 {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    white-space: nowrap;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.03em;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-left: auto;
  }
  .action {
    display: flex;
    flex: none;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    white-space: nowrap;
  }
  .action:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .action:disabled {
    opacity: 0.45;
  }
  .intro {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 10px 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    line-height: 1.4;
  }
  .notice span {
    flex: 1;
  }
  .notice.error {
    border-color: color-mix(in oklab, var(--danger) 45%, transparent);
    color: var(--danger);
  }
  .dismiss {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-muted);
  }
  .dismiss:hover {
    background: var(--surface-hover);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 2px);
    background: var(--bg-elevated);
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px;
    border-radius: var(--radius);
  }
  .row:hover {
    background: var(--surface-hover);
  }
  .row.disabled .icon,
  .row.disabled .title {
    opacity: 0.55;
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-muted);
  }
  .icon img {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .title {
    font-weight: 600;
  }
  .version,
  .detail {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 400;
  }
  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--danger);
    font-size: 12px;
  }
  .private {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-top: 6px;
    font-size: 12px;
  }
  .private-label {
    display: flex;
    flex-direction: column;
  }
  .hint {
    color: var(--text-faint);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 48px 0 8px;
    color: var(--text-muted);
    text-align: center;
  }
  .empty p {
    margin: 0;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
