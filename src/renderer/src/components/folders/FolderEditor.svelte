<script lang="ts">
  import { MAX_FOLDER_DEPTH, folderDepth, type FolderInput, type TabFolder } from "@shared/folders";
  import { SPACE_ICON_LABELS, SPACE_ICONS } from "@shared/spaces";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";

  /**
   * Edit popover of a sidebar folder (ADR-022): name, icon, sub-folder, deletion. Deleting asks
   * whether its tabs are closed too or go back to the parent folder.
   */
  let { folder, count, onClose }: { folder: TabFolder; count: number; onClose: () => void } = $props();

  let name = $state("");
  let confirming = $state(false);
  let nameInput = $state<HTMLInputElement>();
  let cancelButton = $state<HTMLButtonElement>();

  $effect.pre(() => {
    name = folder.name;
    confirming = false;
  });

  $effect(() => {
    void folder.id;
    nameInput?.focus();
    nameInput?.select();
  });

  $effect(() => {
    if (confirming) cancelButton?.focus();
  });

  const folders = $derived(browser.state.folders ?? []);
  const canNest = $derived(folderDepth(folders, folder.id) < MAX_FOLDER_DEPTH);

  function update(input: FolderInput): void {
    api.folders.update(folder.id, input);
  }

  function commitName(): void {
    if (name.trim() && name !== folder.name) update({ name });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (confirming) confirming = false;
      else onClose();
    }
  }

  function remove(closeTabs: boolean): void {
    api.folders.remove(folder.id, closeTabs);
    onClose();
  }

  function deleteFolder(): void {
    // An empty folder goes at once: there is nothing to decide.
    if (count === 0) remove(false);
    else confirming = true;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="editor" role="dialog" aria-label="Modifier le dossier" tabindex="-1" onkeydown={onKeydown} data-testid="folder-editor">
  {#if confirming}
    <div class="confirm">
      <p>
        Supprimer le dossier <strong>« {folder.name} »</strong> ? Il contient {count} onglet{count > 1 ? "s" : ""}.
      </p>
      <div class="choices">
        <button class="danger" onclick={() => remove(true)}>Supprimer et fermer les onglets</button>
        <button class="secondary" onclick={() => remove(false)}>Supprimer, garder les onglets</button>
        <button class="plain" bind:this={cancelButton} onclick={() => (confirming = false)}>Annuler</button>
      </div>
    </div>
  {:else}
    <div class="name-row">
      <span class="preview"><Icon name={folder.icon} size={16} /></span>
      <input
        bind:this={nameInput}
        bind:value={name}
        aria-label="Nom du dossier"
        maxlength="40"
        spellcheck="false"
        onchange={commitName}
        onkeydown={(event) => event.key === "Enter" && (commitName(), onClose())}
      />
    </div>

    <div class="icons" role="radiogroup" aria-label="Icône">
      {#each SPACE_ICONS as icon (icon)}
        <button
          role="radio"
          aria-checked={folder.icon === icon}
          aria-label={SPACE_ICON_LABELS[icon]}
          title={SPACE_ICON_LABELS[icon]}
          class:selected={folder.icon === icon}
          onclick={() => update({ icon })}><Icon name={icon} size={16} /></button
        >
      {/each}
    </div>

    <div class="actions">
      <button class="delete" onclick={deleteFolder}><Icon name="trash" size={12} /> Supprimer</button>
      <span class="spacer"></span>
      <button class="secondary" disabled={!canNest} onclick={() => (api.folders.create({}, folder.id), onClose())}>
        <Icon name="folder-plus" size={12} /> Sous-dossier
      </button>
      <button class="primary" onclick={() => (commitName(), onClose())}>Terminé</button>
    </div>
  {/if}
</div>

<style>
  .editor {
    position: absolute;
    right: 8px;
    bottom: 54px;
    left: var(--gutter);
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 14px;
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 40px -12px rgb(0 0 0 / 0.55);
    animation: pop 0.16s var(--ease);
    transform-origin: bottom left;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.97);
    }
  }
  .name-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .preview {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: var(--surface);
    color: var(--text-muted);
  }
  .name-row input {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    outline: none;
    background: var(--surface);
    font-weight: 600;
  }
  .name-row input:focus {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
  }
  .icons {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 2px;
  }
  .icons button {
    display: grid;
    place-items: center;
    height: 28px;
    border-radius: 8px;
    color: var(--text-muted);
  }
  .icons button:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .icons button.selected {
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent-text) 55%, transparent);
    color: var(--accent-text);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .spacer {
    flex: 1;
  }
  .actions button,
  .choices button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    font-weight: 500;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .secondary {
    background: var(--surface-hover);
  }
  .secondary:disabled {
    opacity: 0.4;
  }
  .delete {
    color: var(--text-muted);
  }
  .delete:hover {
    background: color-mix(in oklab, #e5484d 15%, transparent);
    color: #ff6b6f;
  }
  .danger {
    background: #e5484d;
    color: #fff;
  }
  .plain {
    color: var(--text-muted);
  }
  .confirm p {
    margin: 0 0 10px;
    line-height: 1.45;
  }
  .choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>
