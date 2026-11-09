<script lang="ts">
  import { t, intlLocale } from "@shared/i18n";
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

  const source = $derived(extension.webStoreId ? "Chrome Web Store" : extension.managed ? t("extensionRow.installedFromFile") : t("extensionRow.unpackedFolder"));
  const when = (time: number) => new Date(time).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" });
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
        <button type="button" class="link" title={t("extensionRow.openPageChromeWeb")} onclick={() => api.tabs.create(storeLink)}>{source} <Icon name="open" size={12} /></button>
      {:else}
        {source}
      {/if}
      {t("extensionRow.manifestV", { manifestVersion: extension.manifestVersion })}
    </span>
    {#if extension.error}
      <span class="error"><Icon name="warning" size={12} /> {extension.error}</span>
    {/if}
    {#if open}
      <div class="details" data-testid="extension-details">
        <section>
          <h3>{t("extensionRow.siteAccess")}</h3>
          {#if details?.hosts.length}
            <ul class="chips">
              {#each details.hosts as host (host)}<li>{host}</li>{/each}
            </ul>
          {:else}
            <p>{t("extensionRow.noSites")}</p>
          {/if}
        </section>
        <section>
          <h3>{t("extensionRow.permissions")}</h3>
          {#if extension.permissions.length}
            <ul class="plain">
              {#each extension.permissions as permission (permission)}<li><Icon name="check" size={12} /> {permission}</li>{/each}
            </ul>
          {:else}
            <p>{t("extensionRow.noParticularPermissions")}</p>
          {/if}
          {#if details?.apiPermissions.length}
            <p class="faint">{t("extensionRow.declared", { p: details.apiPermissions.join(", ") })}</p>
          {/if}
        </section>
        <section class="facts">
          {#if details}
            <span>{t("extensionRow.size", { p: formatSize(details.size) })}</span>
            {#if extension.webStoreId}
              <span>
                {details.lastUpdateCheck ? t("extensionRow.updatesLastCheck", { date: when(details.lastUpdateCheck) }) : t("extensionRow.updatesNeverChecked")}
              </span>
            {:else}
              <span>{t("extensionRow.updatesManualOutsideChrome")}</span>
            {/if}
            {#if details.folder}<span class="path" title={details.folder}>{t("extensionRow.folder", { folder: details.folder })}</span>{/if}
            <span>{t("extensionRow.id", { p: extension.webStoreId ?? extension.id })}</span>
          {/if}
        </section>
        {#if !browser.isPrivate}
          <label class="private">
            <Toggle
              label={t("extensionRow.allowPrivateBrowsing", { name: extension.name })}
              checked={extension.allowPrivate}
              onchange={(allowed) => api.extensions.setPrivateAllowed(extension.id, allowed)}
            />
            <span>
              {t("extensionRow.allowPrivateBrowsing2")}
              <span class="faint">
                {t("extensionRow.savedButNoEffect")}
              </span>
            </span>
          </label>
        {/if}
        {#if details?.hasOptions && !browser.isPrivate}
          <div>
            <Button size="sm" icon="settings" disabled={!extension.enabled} onclick={openOptions}>{t("extensionRow.openOptions")}</Button>
            {#if optionsMissing}<span class="faint">{t("extensionRow.turnExtensionOpenOptions")}</span>{/if}
          </div>
        {/if}
      </div>
    {/if}
  </span>
  <span class="controls">
    <Button size="sm" variant="quiet" aria-expanded={open} onclick={() => (open = !open)}>
      {t("extensionRow.details")} <Icon name={open ? "chevron-up" : "chevron-down"} size={12} />
    </Button>
    {#if !browser.isPrivate}
      {#if extension.action}
        <IconButton
          size="row"
          icon="pin"
          iconSize={14}
          pressed={extension.pinned}
          label={extension.pinned ? t("extensionRow.unpin", { name: extension.name }) : t("extensionRow.pin", { name: extension.name })}
          title={extension.pinned ? t("extensionRow.removeButtonFromSidebar") : t("extensionRow.showButtonSidebar")}
          onclick={() => api.extensions.setPinned(extension.id, !extension.pinned)}
        />
      {/if}
      <Toggle
        label={`${extension.enabled ? t("extensionRow.turnOff") : t("extensionRow.turn")} ${extension.name}`}
        checked={extension.enabled}
        onchange={(enabled) => api.extensions.setEnabled(extension.id, enabled)}
      />
      <ConfirmButton question={t("extensionRow.removeExtension")} confirmLabel={t("extensionRow.remove")} title={t("extensionRow.remove2", { name: extension.name })} onconfirm={() => api.extensions.remove(extension.id)}>
        <Icon name="trash" size={12} /> {t("extensionRow.remove")}
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
