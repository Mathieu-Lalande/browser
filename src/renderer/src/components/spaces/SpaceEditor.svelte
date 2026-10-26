<script lang="ts">
  import { SPACE_COLORS, SPACE_ICONS } from "@shared/spaces";
  import type { SpaceInfo, SpaceInput } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";

  /** Edit popover of a space, inside the sidebar (above the space switcher). */
  let { space, onClose }: { space: SpaceInfo; onClose: () => void } = $props();

  let name = $state("");
  let confirming = $state(false);
  let nameInput = $state<HTMLInputElement>();

  // Reset local fields when another space is edited.
  $effect.pre(() => {
    name = space.name;
    confirming = false;
  });

  $effect(() => {
    void space.id;
    nameInput?.focus();
    nameInput?.select();
  });

  const canDelete = $derived(browser.state.spaces.length > 1);

  function update(input: SpaceInput): void {
    api.spaces.update(space.id, input);
  }

  function commitName(): void {
    if (name.trim() && name !== space.name) update({ name });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (confirming) confirming = false;
      else onClose();
    }
  }

  function remove(): void {
    api.spaces.remove(space.id);
    onClose();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="editor" role="dialog" aria-label="Modifier l'espace" tabindex="-1" onkeydown={onKeydown}>
  {#if confirming}
    <div class="confirm">
      <p>Supprimer l'espace <strong>« {space.name} »</strong> ? Ses onglets seront fermés{space.isolated
          ? ", et ses cookies et données effacés"
          : ""}.</p>
      <div class="actions">
        <button class="secondary" onclick={() => (confirming = false)}>Annuler</button>
        <button class="danger" onclick={remove}>Supprimer</button>
      </div>
    </div>
  {:else}
    <div class="name-row">
      <span class="preview" style:--dot={space.color ?? "var(--accent)"}>{space.icon}</span>
      <input
        bind:this={nameInput}
        bind:value={name}
        aria-label="Nom de l'espace"
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
          aria-checked={space.icon === icon}
          aria-label={icon}
          class:selected={space.icon === icon}
          onclick={() => update({ icon })}>{icon}</button
        >
      {/each}
    </div>

    <div class="colors" role="radiogroup" aria-label="Couleur">
      <button
        class="swatch theme"
        role="radio"
        aria-checked={space.color === null}
        aria-label="Couleur du thème"
        title="Couleur du thème"
        class:selected={space.color === null}
        onclick={() => update({ color: null })}
      ></button>
      {#each SPACE_COLORS as color (color)}
        <button
          class="swatch"
          role="radio"
          aria-checked={space.color === color}
          aria-label={color}
          class:selected={space.color === color}
          style:--swatch={color}
          onclick={() => update({ color })}
        ></button>
      {/each}
    </div>

    <label class="isolated">
      <input type="checkbox" checked={space.isolated} onchange={(event) => update({ isolated: event.currentTarget.checked })} />
      <span>
        <strong>Espace isolé</strong>
        <small>Cookies, connexions et stockage séparés des autres espaces. Les onglets se rechargent.</small>
      </span>
    </label>

    <div class="actions">
      <button class="delete" disabled={!canDelete} onclick={() => (confirming = true)}>
        <Icon name="trash" size={13} /> Supprimer
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
    background: color-mix(in oklab, var(--dot) 22%, transparent);
    font-size: 17px;
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
    height: 26px;
    border-radius: 7px;
    font-size: 14px;
  }
  .icons button:hover {
    background: var(--surface-hover);
  }
  .icons button.selected {
    background: var(--surface-active);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 55%, transparent);
  }
  .colors {
    display: flex;
    justify-content: space-between;
    padding: 0 2px;
  }
  .swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
    transition: transform 0.12s var(--ease);
  }
  .swatch:hover {
    transform: scale(1.12);
  }
  .swatch.theme {
    background: conic-gradient(from 45deg, #8b7bff, #d77bff, #5aa9ff, #8b7bff);
  }
  .swatch.selected {
    box-shadow:
      0 0 0 2px var(--bg-elevated),
      0 0 0 4px var(--text-muted);
  }
  .isolated {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px;
    border-radius: 9px;
    background: var(--surface);
  }
  .isolated input {
    margin: 2px 0 0;
    accent-color: var(--accent);
  }
  .isolated span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .isolated small {
    color: var(--text-muted);
    font-size: 11.5px;
    line-height: 1.35;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .actions button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 12px;
    border-radius: 8px;
    font-weight: 500;
  }
  .primary {
    background: var(--accent);
    color: #fff;
  }
  .secondary {
    background: var(--surface-hover);
  }
  .delete {
    color: var(--text-muted);
  }
  .delete:hover:not(:disabled) {
    background: color-mix(in oklab, #e5484d 15%, transparent);
    color: #ff6b6f;
  }
  .delete:disabled {
    opacity: 0.4;
  }
  .danger {
    background: #e5484d;
    color: #fff;
  }
  .confirm p {
    margin: 0 0 10px;
    line-height: 1.45;
  }
</style>
