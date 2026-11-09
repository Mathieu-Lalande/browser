<script lang="ts">
  import { formatSize, type ExtensionDetailsInfo, type ExtensionInfo } from "@shared/extensions";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import ListRow from "../ui/ListRow.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /**
   * One extension of `browser://extensions` (ADR-024, ADR-049): icon, name, version, description and
   * source (a link to its Web Store page, or "fichier"/"dossier"), its switch, pin and removal;
   * "Détails" unfolds what main reads from its folder when asked (sites, permissions, size, last
   * update check, options page, private browsing).
   */
  let { extension, storeLink }: { extension: ExtensionInfo; storeLink: string | null } = $props();

  let open = $state(false);
  let details = $state<ExtensionDetailsInfo | null>(null);
  let optionsMissing = $state(false);

  $effect(() => {
    if (!open) return;
    // Re-read when the extension changes (update, switch).
    void extension.version;
    void api.extensions.details(extension.id).then((next) => (details = next), () => null);
  });

  async function openOptions(): Promise<void> {
    optionsMissing = !(await api.extensions.openOptions(extension.id).catch(() => false));
  }

  const source = $derived(extension.webStoreId ? "Chrome Web Store" : extension.managed ? "Installée depuis un fichier" : "Dossier non empaqueté");
  const when = (time: number) => new Date(time).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
</script>

<ListRow align="start" disabled={!extension.enabled} data-extension-id={extension.id}>
  <span class="icon">
    {#if extension.icon}
      <img src={extension.icon} alt="" />
    {:else}
      <Icon name="extension" size={18} />
    {/if}
  </span>
  <span class="text">
    <span class="title">{extension.name} <span class="version">{extension.version}</span></span>
    {#if extension.description}<span class="detail">{extension.description}</span>{/if}
    <span class="detail source">
      {#if storeLink}
        <button type="button" class="link" title="Ouvrir sa page sur le Chrome Web Store" onclick={() => api.tabs.create(storeLink)}>{source} <Icon name="open" size={12} /></button>
      {:else}
        {source}
      {/if}
      · Manifest V{extension.manifestVersion}
    </span>
    {#if extension.error}
      <span class="error"><Icon name="warning" size={12} /> {extension.error}</span>
    {/if}
    {#if open}
      <div class="details" data-testid="extension-details">
        <section>
          <h3>Accès aux sites</h3>
          {#if details?.hosts.length}
            <ul class="chips">
              {#each details.hosts as host (host)}<li>{host}</li>{/each}
            </ul>
          {:else}
            <p>Aucun site.</p>
          {/if}
        </section>
        <section>
          <h3>Autorisations</h3>
          {#if extension.permissions.length}
            <ul class="plain">
              {#each extension.permissions as permission (permission)}<li><Icon name="check" size={12} /> {permission}</li>{/each}
            </ul>
          {:else}
            <p>Aucune autorisation particulière.</p>
          {/if}
          {#if details?.apiPermissions.length}
            <p class="faint">Déclarées : {details.apiPermissions.join(", ")}</p>
          {/if}
        </section>
        <section class="facts">
          {#if details}
            <span>Taille : {formatSize(details.size)}</span>
            {#if extension.webStoreId}
              <span>
                Mises à jour : {details.lastUpdateCheck ? `dernière vérification le ${when(details.lastUpdateCheck)}` : "jamais vérifiées"}
              </span>
            {:else}
              <span>Mises à jour : manuelles (hors Chrome Web Store)</span>
            {/if}
            {#if details.folder}<span class="path" title={details.folder}>Dossier : {details.folder}</span>{/if}
            <span>Identifiant : {extension.webStoreId ?? extension.id}</span>
          {/if}
        </section>
        {#if !browser.isPrivate}
          <label class="private">
            <Toggle
              label={`Autoriser ${extension.name} en navigation privée`}
              checked={extension.allowPrivate}
              onchange={(allowed) => api.extensions.setPrivateAllowed(extension.id, allowed)}
            />
            <span>
              Autoriser en navigation privée
              <span class="faint">
                Enregistré, mais sans effet aujourd'hui : une fenêtre privée garde tout en mémoire, et le moteur (Electron) ne sait pas
                charger d'extension dans ce type de session. Aucune extension ne voit donc vos pages privées.
              </span>
            </span>
          </label>
        {/if}
        {#if details?.hasOptions && !browser.isPrivate}
          <div>
            <Button size="sm" icon="settings" disabled={!extension.enabled} onclick={openOptions}>Ouvrir les options</Button>
            {#if optionsMissing}<span class="faint">Activez l'extension pour ouvrir ses options.</span>{/if}
          </div>
        {/if}
      </div>
    {/if}
  </span>
  <span class="controls">
    <Button size="sm" variant="quiet" aria-expanded={open} onclick={() => (open = !open)}>
      Détails <Icon name={open ? "chevron-up" : "chevron-down"} size={12} />
    </Button>
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
  </span>
</ListRow>

<style>
  :global(.row.disabled) .icon,
  :global(.row.disabled) .title {
    opacity: 0.55;
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text-muted);
  }
  .icon img {
    width: var(--space-5);
    height: var(--space-5);
    object-fit: contain;
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
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
  .link {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--accent-text);
  }
  .error {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--danger-text);
    font-size: var(--text-xs);
  }
  .controls {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
  }
  .details {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-size: var(--text-xs);
  }
  h3 {
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .details p {
    margin: 0;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .chips li {
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-active);
  }
  .plain {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .plain li {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .facts {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--text-muted);
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .faint {
    color: var(--text-faint);
  }
  .private {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .private > span {
    display: flex;
    flex-direction: column;
  }
</style>
