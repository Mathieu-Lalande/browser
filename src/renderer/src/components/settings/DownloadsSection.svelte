<script lang="ts">
  import { t } from "@shared/i18n";
  import { api } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";

  const s = $derived(settings.current.downloads);

  /** The folder is chosen with the native dialog in main, which saves it and broadcasts the new settings. */
  function choose(): void {
    api.downloads.chooseFolder().catch(() => {});
  }
</script>

<Row anchor="folder" label={t("downloadsSection.folder")} hint={s.folder ? undefined : t("downloadsSection.systemDownloadsFolder")}>
  <!-- Long paths are cut on the left: the end of a path is the part that matters. -->
  {#if s.folder}<span class="path" title={s.folder}><bdi>{s.folder}</bdi></span>{/if}
  {#if s.folder}
    <button class="secondary" onclick={() => settings.update({ downloads: { folder: "" } })}>{t("downloadsSection.default")}</button>
  {/if}
  <button class="secondary" onclick={choose}><Icon name="folder" size={12} /> {t("downloadsSection.change")}</button>
</Row>
<Row anchor="ask-where" label={t("downloadsSection.alwaysAskWhereSave")} hint={t("downloadsSection.otherwiseFilesAreSaved")}>
  <Toggle label={t("downloadsSection.alwaysAskWhereSave")} checked={s.askWhere} onchange={(askWhere) => settings.update({ downloads: { askWhere } })} />
</Row>
<Row anchor="executables" label={t("downloadsSection.executableFiles")} hint={t("downloadsSection.programsInstallersScriptsExe")}>
  <!-- A fixed safeguard, not a setting: plain status text, nothing to click. -->
  <span class="status">{t("downloadsSection.always")}</span>
</Row>

<style>
  .path {
    max-width: 260px;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }
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
  .secondary:hover {
    background: var(--surface-hover);
  }
  .status {
    color: var(--text-faint);
    font-size: 12px;
    white-space: nowrap;
  }
</style>
