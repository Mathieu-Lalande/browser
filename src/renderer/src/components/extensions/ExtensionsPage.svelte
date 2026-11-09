<script lang="ts">
  import ListRow from "../ui/ListRow.svelte";
  import Card from "../ui/Card.svelte";
  import type { ExtensionInfo, ExtensionInstallResult } from "@shared/extensions";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import Button from "../ui/Button.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Page from "../ui/Page.svelte";

  /**
   * `browser://extensions` (ADR-024, ADR-049): installed extensions, to switch on/off, pin in the
   * sidebar, allow in private windows or remove; installing asks main for a folder or a .zip/.crx
   * through a file dialog, or comes from a Chrome Web Store page ("Ajouter à Browser"), whose
   * extensions are updated from here or daily. A private window only lists them.
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

  const fromStore = $derived(extensions.some((extension) => extension.webStoreId));

  async function checkUpdates(): Promise<void> {
    busy = true;
    notice = null;
    const result = await api.extensions.checkUpdates().catch(() => ({ ok: false, message: "La vérification des mises à jour a échoué." }));
    busy = false;
    notice = { kind: result.ok ? "success" : "error", text: result.message };
    void refresh();
  }

  const sourceOf = (extension: ExtensionInfo) =>
    extension.webStoreId ? "Chrome Web Store" : extension.managed ? "installée depuis un fichier" : "dossier non empaqueté";
</script>

{#snippet subtitle()}
  {#if browser.isPrivate}
    Les extensions se gèrent depuis une fenêtre normale. Elles ne s'appliquent pas aux fenêtres privées.
  {:else}
    Extensions Chrome (Manifest V2 ou V3) appliquées aux pages de tous vos espaces. Pour en ajouter une, ouvrez sa page sur le
    Chrome Web Store puis « Ajouter à Browser ». Le navigateur prend en charge une partie des API d'extension : les scripts de
    contenu, les fenêtres des boutons d'extension et la plupart des extensions simples fonctionnent ; les badges et les clics sans
    fenêtre ne sont pas transmis.
  {/if}
{/snippet}

<Page icon="extension" title="Extensions" {subtitle} testid="extensions-page">
  {#snippet actions()}
    {#if !browser.isPrivate}
      {#if fromStore}
        <Button icon="download" disabled={busy} onclick={checkUpdates} title="Installer les nouvelles versions publiées sur le Chrome Web Store">
          Mettre à jour les extensions
        </Button>
      {/if}
      <Button icon="folder-open" disabled={busy} onclick={() => install("folder")} title="Extension non empaquetée (dossier contenant manifest.json)">
        Charger un dossier
      </Button>
      <Button variant="primary" icon="file-archive" disabled={busy} onclick={() => install("file")} title="Archive .zip ou extension .crx">
        Installer un fichier
      </Button>
    {/if}
  {/snippet}

    {#if notice}
      <p class="notice {notice.kind}" role={notice.kind === "error" ? "alert" : "status"}>
        <Icon name={notice.kind === "error" ? "warning" : "check"} size={14} />
        <span>{notice.text}</span>
        <IconButton size="row" icon="close" iconSize={14} label="Fermer le message" onclick={() => (notice = null)} />
      </p>
    {/if}

    {#if extensions.length}
      <Card as="ul">
        {#each extensions as extension (extension.id)}
          <ListRow align="start" disabled={!extension.enabled} data-extension-id={extension.id}>
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
                Manifest V{extension.manifestVersion} · {sourceOf(extension)}
              </span>
              {#if extension.permissions.length}
                <span class="detail" title={extension.permissions.join("\n")}>Autorisations : {extension.permissions.join(" · ")}</span>
              {/if}
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
                    <span class="hint">
                      Enregistré, mais sans effet aujourd'hui : une fenêtre privée garde tout en mémoire pour ne rien laisser sur le disque,
                      et le moteur (Electron) ne sait pas charger d'extension dans ce type de session. Aucune extension ne voit donc vos
                      pages privées.
                    </span>
                  </span>
                </span>
              {/if}
            </span>
            {#if !browser.isPrivate}
              {#if extension.action}
                <IconButton
                  size="row"
                  icon="pin"
                  iconSize={14}
                  pressed={extension.pinned}
                  label={extension.pinned ? `Désépingler ${extension.name}` : `Épingler ${extension.name}`}
                  title={extension.pinned ? "Retirer son bouton de la barre latérale" : "Afficher son bouton dans la barre latérale"}
                  onclick={() => api.extensions.setPinned(extension.id, !extension.pinned)}
                />
              {/if}
              <Toggle
                label={`${extension.enabled ? "Désactiver" : "Activer"} ${extension.name}`}
                checked={extension.enabled}
                onchange={(enabled) => api.extensions.setEnabled(extension.id, enabled)}
              />
              <ConfirmButton question="Retirer cette extension ?" confirmLabel="Retirer" title={`Retirer ${extension.name}`} onconfirm={() => api.extensions.remove(extension.id)}>
                <Icon name="trash" size={12} /> Retirer
              </ConfirmButton>
            {/if}
          </ListRow>
        {/each}
      </Card>
      {#if fromStore && !browser.isPrivate}
        <label class="auto-update">
          <Toggle
            label="Mettre à jour automatiquement les extensions du Chrome Web Store"
            checked={settings.current.extensions.autoUpdate}
            onchange={(autoUpdate) => settings.update({ extensions: { autoUpdate } })}
          />
          <span>Vérifier chaque jour les nouvelles versions sur le Chrome Web Store (une version qui demande de nouvelles autorisations attend votre accord).</span>
        </label>
      {/if}
    {:else if loaded}
      <EmptyState
        icon="extension"
        title="Aucune extension installée"
        hint={browser.isPrivate
          ? undefined
          : "Ouvrez une extension sur le Chrome Web Store puis « Ajouter à Browser », chargez le dossier d'une extension (contenant manifest.json) ou installez une archive .zip ou .crx."}
      />
    {/if}
</Page>

<style>
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
    color: var(--danger-text);
  }
  :global(.row.disabled) .icon,
  :global(.row.disabled) .title {
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
    font-size: var(--text-xs);
    font-weight: 400;
  }
  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--danger-text);
    font-size: var(--text-xs);
  }
  .private {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-top: 6px;
    font-size: var(--text-xs);
  }
  .private-label {
    display: flex;
    flex-direction: column;
  }
  .hint {
    color: var(--text-faint);
  }
  .auto-update {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>
