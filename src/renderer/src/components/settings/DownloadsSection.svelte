<script lang="ts">
  import { api } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import Row from "./Row.svelte";
  import Toggle from "./Toggle.svelte";

  const s = $derived(settings.current.downloads);

  /** The folder is chosen with the native dialog in main, which saves it and broadcasts the new settings. */
  function choose(): void {
    api.downloads.chooseFolder().catch(() => {});
  }
</script>

<Row label="Dossier" hint={s.folder ? undefined : "Dossier Téléchargements du système."}>
  <!-- Long paths are cut on the left: the end of a path is the part that matters. -->
  {#if s.folder}<span class="path" title={s.folder}><bdi>{s.folder}</bdi></span>{/if}
  {#if s.folder}
    <button class="secondary" onclick={() => settings.update({ downloads: { folder: "" } })}>Par défaut</button>
  {/if}
  <button class="secondary" onclick={choose}><Icon name="folder" size={13} /> Modifier…</button>
</Row>
<Row label="Toujours demander où enregistrer" hint="Sinon, les fichiers sont enregistrés directement, sans boîte de dialogue.">
  <Toggle label="Toujours demander où enregistrer" checked={s.askWhere} onchange={(askWhere) => settings.update({ downloads: { askWhere } })} />
</Row>
<Row label="Fichiers exécutables" hint="Programmes, installeurs et scripts (.exe, .dmg, .sh…) attendent votre confirmation avant d'arriver dans le dossier. Rien n'est jamais ouvert automatiquement.">
  <span class="badge"><Icon name="shield" size={13} /> Toujours</span>
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
  .badge {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
