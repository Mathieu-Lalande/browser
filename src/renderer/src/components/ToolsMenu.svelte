<script lang="ts">
  import { getCommand, type CommandId } from "@shared/commands";
  import { api } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import Icon from "./Icon.svelte";

  /**
   * Sidebar footer menu to the internal pages that have no button of their own (ADR-012). It opens
   * upwards inside the sidebar: the chrome cannot draw over the page view.
   */
  const ITEMS: CommandId[] = ["open-passwords", "open-boosts", "open-extensions", "open-archive"];

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let toggle: HTMLButtonElement | undefined = $state();

  function run(id: CommandId): void {
    open = false;
    api.commands.run(id);
  }

  function onWindowPointer(event: PointerEvent): void {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    open = false;
    toggle?.focus();
  }

  /** Arrow keys move between the items, like a native menu. */
  function onMenuKey(event: KeyboardEvent): void {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const items = [...(root?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + step + items.length) % items.length]?.focus();
  }

  $effect(() => {
    if (open) root?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  });
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="tools" bind:this={root} onkeydown={onKey} role="presentation">
  {#if open}
    <div class="menu" role="menu" aria-label="Outils" tabindex="-1" onkeydown={onMenuKey}>
      {#each ITEMS as id (id)}
        {@const command = getCommand(id)}
        <button role="menuitem" title={platform.tip(command.label, id)} onclick={() => run(id)}>
          <Icon name={command.icon} size={15} />
          <span>{command.label}</span>
        </button>
      {/each}
    </div>
  {/if}
  <button
    bind:this={toggle}
    class="icon"
    class:active={open}
    aria-label="Outils"
    aria-haspopup="menu"
    aria-expanded={open}
    title="Mots de passe, Boosts, Extensions, Onglets archivés"
    onclick={() => (open = !open)}
  >
    <Icon name="more" />
  </button>
</div>

<style>
  .tools {
    position: relative;
    display: flex;
  }
  .menu {
    position: absolute;
    right: 0;
    bottom: calc(100% + 6px);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 190px;
    max-width: calc(var(--sidebar-width) - 16px);
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / 0.5);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 32px;
    padding: 0 10px;
    border: none;
    border-radius: calc(var(--radius) - 3px);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }
  .menu button span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--icon-button);
    height: var(--icon-button);
    border-radius: 8px;
    color: var(--text-muted);
  }
  .icon:hover,
  .icon.active {
    background: var(--surface-hover);
    color: var(--text);
  }
  .menu button:hover,
  .menu button:focus-visible {
    background: var(--surface-hover);
    outline: none;
  }
</style>
