<script lang="ts">
  import { t, intlLocale } from "@shared/i18n";
  import Card from "../ui/Card.svelte";
  import type { DroppedExtension, ExtensionInfo, ExtensionInstallResult } from "@shared/extensions";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import { readDrop } from "../../lib/extension-drop";
  import Icon from "../Icon.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import Button from "../ui/Button.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Page from "../ui/Page.svelte";
  import SearchField from "../ui/SearchField.svelte";
  import ExtensionRow from "./ExtensionRow.svelte";

  /**
   * `browser://extensions` (ADR-024, ADR-049): installed extensions to search, switch on/off, pin
   * in the sidebar, inspect ("Détails") or remove; installing asks main for a folder or a .zip/.crx
   * through a file dialog, takes a package dropped on the page (sent as bytes, then the permission
   * review), or comes from a Chrome Web Store page ("Ajouter à Browser"), whose extensions are
   * updated from here or daily. A private window only lists them.
   */

  let extensions = $state<ExtensionInfo[]>([]);
  let loaded = $state(false);
  let busy = $state(false);
  let query = $state("");
  let dragging = $state(false);
  let lastCheck = $state<number | null>(null);
  let notice = $state<{ kind: "error" | "success"; text: string } | null>(null);
  let request = 0;

  async function refresh(): Promise<void> {
    const id = ++request;
    const list = await api.extensions.list().catch(() => []);
    if (id !== request) return;
    extensions = list;
    loaded = true;
    const store = list.find((extension) => extension.webStoreId);
    lastCheck = store ? ((await api.extensions.details(store.id).catch(() => null))?.lastUpdateCheck ?? null) : null;
  }

  $effect(() => {
    void refresh();
    return api.extensions.onChanged(() => void refresh());
  });

  function report(result: ExtensionInstallResult): void {
    if (!result) return;
    notice = result.ok ? { kind: "success", text: t("extensionsPage.installed", { name: result.extension.name }) } : { kind: "error", text: result.message };
    void refresh();
  }

  async function install(kind: "folder" | "file"): Promise<void> {
    busy = true;
    notice = null;
    const result = await (kind === "folder" ? api.extensions.installFromFolder() : api.extensions.installFromFile()).catch(
      (): ExtensionInstallResult => ({ ok: false, message: t("extensionsPage.installationFailed") }),
    );
    busy = false;
    report(result);
  }

  const fromStore = $derived(extensions.some((extension) => extension.webStoreId));
  const shown = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase(intlLocale());
    if (!needle) return extensions;
    return extensions.filter((extension) => `${extension.name} ${extension.description}`.toLocaleLowerCase(intlLocale()).includes(needle));
  });

  async function checkUpdates(): Promise<void> {
    busy = true;
    notice = null;
    const result = await api.extensions.checkUpdates().catch(() => ({ ok: false, message: t("extensionsPage.checkingUpdatesFailed") }));
    busy = false;
    notice = { kind: result.ok ? "success" : "error", text: result.message };
    void refresh();
  }

  const hasFiles = (event: DragEvent) => !browser.isPrivate && !!event.dataTransfer?.types.includes("Files");

  async function drop(event: DragEvent): Promise<void> {
    dragging = false;
    if (!hasFiles(event) || !event.dataTransfer) return;
    event.preventDefault();
    busy = true;
    notice = null;
    let dropped: DroppedExtension | string;
    try {
      dropped = await readDrop(event.dataTransfer);
    } catch {
      dropped = t("extensionsPage.cantReadWhatWas");
    }
    const result: ExtensionInstallResult =
      typeof dropped === "string"
        ? { ok: false, message: dropped }
        : await api.extensions.installDropped(dropped).catch((): ExtensionInstallResult => ({ ok: false, message: t("extensionsPage.installationFailed") }));
    busy = false;
    report(result);
  }

  const storeLink = (extension: ExtensionInfo) => (extension.webStoreId ? `https://chromewebstore.google.com/detail/${extension.webStoreId}` : null);
  const when = (time: number) => new Date(time).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" });
</script>

{#snippet subtitle()}
  {#if browser.isPrivate}
    {t("extensionsPage.extensionsAreManagedFrom")}
  {:else}
    {t("extensionsPage.chromeExtensionsManifestV2")}
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="drop-target"
  class:dragging
  ondragover={(event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dragging = true;
  }}
  ondragleave={(event) => {
    if (event.currentTarget === event.target) dragging = false;
  }}
  ondrop={drop}
  data-testid="extensions-drop"
>
  <Page icon="extension" title={t("extensionsPage.extensions")} {subtitle} testid="extensions-page">
    {#snippet actions()}
      {#if !browser.isPrivate}
        {#if fromStore}
          <Button icon="download" disabled={busy} onclick={checkUpdates} title={t("extensionsPage.installNewVersionsPublished")}>
            {t("extensionsPage.updateExtensions")}
          </Button>
        {/if}
        <Button icon="folder-open" disabled={busy} onclick={() => install("folder")} title={t("extensionsPage.unpackedExtensionFolderContaining")}>
          {t("extensionsPage.loadFolder")}
        </Button>
        <Button variant="primary" icon="file-archive" disabled={busy} onclick={() => install("file")} title={t("extensionsPage.zipArchiveCrxExtension")}>
          {t("extensionsPage.installFile")}
        </Button>
      {/if}
    {/snippet}

    {#if extensions.length > 1}
      <SearchField bind:value={query} label={t("extensionsPage.searchExtension")} />
    {/if}

    {#if notice}
      <p class="notice {notice.kind}" role={notice.kind === "error" ? "alert" : "status"}>
        <Icon name={notice.kind === "error" ? "warning" : "check"} size={14} />
        <span>{notice.text}</span>
        <IconButton size="row" icon="close" iconSize={14} label={t("extensionsPage.closeMessage")} onclick={() => (notice = null)} />
      </p>
    {/if}

    {#if dragging}
      <p class="drop-hint" aria-hidden="true"><Icon name="download" size={16} /> {t("extensionsPage.dropCrxZipFile")}</p>
    {/if}

    {#if shown.length}
      <Card as="ul">
        {#each shown as extension (extension.id)}
          <ExtensionRow {extension} storeLink={storeLink(extension)} />
        {/each}
      </Card>
    {:else if extensions.length}
      <EmptyState icon="search" title={t("extensionsPage.noExtensionMatches")} />
    {:else if loaded}
      <EmptyState
        icon="extension"
        title={t("extensionsPage.noExtensionsInstalled")}
        hint={browser.isPrivate
          ? undefined
          : t("extensionsPage.openExtensionChromeWeb")}
      />
    {/if}

    {#if fromStore && !browser.isPrivate}
      <label class="auto-update">
        <Toggle
          label={t("extensionsPage.automaticallyUpdateChromeWeb")}
          checked={settings.current.extensions.autoUpdate}
          onchange={(autoUpdate) => settings.update({ extensions: { autoUpdate } })}
        />
        <span>
          {t("extensionsPage.checkChromeWebStore")}
          <span class="faint" data-testid="extensions-last-check">
            {lastCheck ? t("extensionsPage.lastCheck", { p: when(lastCheck) }) : t("extensionsPage.noCheckYet")}
          </span>
        </span>
      </label>
    {/if}
  </Page>
</div>

<style>
  .drop-target {
    display: contents;
  }
  .notice,
  .drop-hint {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
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
  .drop-hint {
    justify-content: center;
    min-height: calc(var(--hit-min) * 2);
    border-style: dashed;
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .auto-update {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .auto-update > span {
    display: flex;
    flex-direction: column;
  }
  .faint {
    color: var(--text-faint);
  }
</style>
