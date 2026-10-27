<script lang="ts">
  import { canOpenFile, downloadStatus, isActiveDownload, isOpenable, type DownloadEntry } from "@shared/downloads";
  import { displayUrl } from "@shared/url";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";

  /** One download, with the actions its state allows. Used by the popover and `browser://downloads`. */
  let { entry, showSource = false }: { entry: DownloadEntry; showSource?: boolean } = $props();

  const active = $derived(isActiveDownload(entry));
  const openable = $derived(isOpenable(entry));
  /** "Ouvrir" only for types whose default app runs no code (ADR-017); the others: the folder only. */
  const launchable = $derived(canOpenFile(entry));
  const failed = $derived(entry.state === "cancelled" || entry.state === "interrupted");
  const percent = $derived(entry.totalBytes > 0 ? Math.min(100, (entry.receivedBytes / entry.totalBytes) * 100) : null);
  const extension = $derived(/\.([a-z0-9]{1,4})$/i.exec(entry.filename)?.[1].toUpperCase() ?? "");
</script>

<div class="download" class:warning={entry.awaitingConfirmation} class:failed data-state={entry.state}>
  <span class="file" aria-hidden="true">
    {#if entry.awaitingConfirmation}
      <Icon name="warning" size={17} />
    {:else}
      <Icon name="file" size={22} />
      {#if extension}<span class="ext">{extension}</span>{/if}
    {/if}
  </span>

  <div class="body">
    <span class="name" title={entry.path || entry.filename}>{entry.filename}</span>
    <span class="status">{downloadStatus(entry)}</span>
    {#if active}
      <span class="track" class:indeterminate={percent === null} class:paused={entry.state === "paused"}>
        <span class="bar" style:width="{percent ?? 30}%"></span>
      </span>
    {/if}
    {#if showSource && entry.url}<span class="source" title={entry.url}>{displayUrl(entry.url)}</span>{/if}
    {#if entry.awaitingConfirmation}
      <div class="confirm">
        {#if entry.state === "completed"}
          <button class="keep" onclick={() => api.downloads.keep(entry.id)}>Conserver</button>
        {/if}
        <button class="discard" onclick={() => api.downloads.cancel(entry.id)}>Supprimer</button>
      </div>
    {/if}
  </div>

  <div class="actions">
    {#if entry.awaitingConfirmation}
      <!-- Decided with the buttons below the name. -->
    {:else if entry.state === "progressing"}
      <button aria-label="Mettre en pause {entry.filename}" title="Mettre en pause" onclick={() => api.downloads.pause(entry.id)}>
        <Icon name="pause" size={14} />
      </button>
      <button aria-label="Annuler {entry.filename}" title="Annuler" onclick={() => api.downloads.cancel(entry.id)}>
        <Icon name="close" size={14} />
      </button>
    {:else if entry.state === "paused" || (entry.state === "interrupted" && entry.canResume)}
      <button aria-label="Reprendre {entry.filename}" title="Reprendre" onclick={() => api.downloads.resume(entry.id)}>
        <Icon name="play" size={14} />
      </button>
      <button aria-label="Annuler {entry.filename}" title="Annuler" onclick={() => api.downloads.cancel(entry.id)}>
        <Icon name="close" size={14} />
      </button>
    {:else}
      {#if launchable}
        <button aria-label="Ouvrir {entry.filename}" title="Ouvrir" onclick={() => api.downloads.open(entry.id)}>
          <Icon name="open" size={14} />
        </button>
      {/if}
      {#if openable}
        <button
          aria-label="Afficher {entry.filename} dans le dossier"
          title="Afficher dans le dossier"
          onclick={() => api.downloads.showInFolder(entry.id)}
        >
          <Icon name="folder" size={14} />
        </button>
      {/if}
      <button aria-label="Retirer {entry.filename} de la liste" title="Retirer de la liste" onclick={() => api.downloads.remove(entry.id)}>
        <Icon name="trash" size={14} />
      </button>
    {/if}
  </div>
</div>

<style>
  .download {
    --warn: #e8a317;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 8px 10px 10px;
    border-radius: calc(var(--radius) - 2px);
  }
  .download:hover {
    background: var(--surface-hover);
  }
  .file {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: var(--accent-text);
  }
  .ext {
    position: absolute;
    bottom: 5px;
    padding: 0 2px;
    border-radius: 3px;
    background: var(--bg-elevated);
    font-size: 7.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.25;
  }
  .warning .file {
    background: color-mix(in oklab, var(--warn) 20%, transparent);
    color: var(--warn);
  }
  .failed .file {
    background: var(--surface);
    color: var(--text-faint);
  }
  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .name,
  .status,
  .source {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .name {
    color: var(--text);
    font-weight: 500;
  }
  .failed .name {
    color: var(--text-muted);
    text-decoration: line-through;
    text-decoration-color: var(--text-faint);
  }
  .status {
    color: var(--text-muted);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }
  .warning .status {
    color: var(--warn);
  }
  .source {
    color: var(--text-faint);
    font-size: 11px;
  }
  .track {
    position: relative;
    height: 4px;
    margin: 3px 0 1px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--surface-active);
  }
  .bar {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    transition: width 0.25s linear;
  }
  .paused .bar {
    background: var(--text-faint);
  }
  .indeterminate .bar {
    animation: slide 1.2s var(--ease) infinite;
  }
  .confirm {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .confirm button {
    height: 26px;
    padding: 0 12px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 500;
  }
  .keep {
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .keep:hover {
    background: var(--surface-hover);
  }
  .discard {
    background: var(--warn);
    color: #1d1400;
  }
  .discard:hover {
    background: color-mix(in oklab, var(--warn) 85%, #fff);
  }
  .actions {
    display: flex;
    flex: none;
    gap: 2px;
  }
  .actions button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    color: var(--text-muted);
  }
  .actions button:hover {
    background: var(--surface-active);
    color: var(--text);
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
</style>
