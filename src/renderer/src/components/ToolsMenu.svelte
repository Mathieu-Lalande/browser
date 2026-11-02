<script lang="ts">
  import { getCommand, type CommandId } from "@shared/commands";
  import { api } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import Menu from "./ui/Menu.svelte";
  import MenuItem from "./ui/MenuItem.svelte";

  /**
   * Sidebar footer menu to the internal pages that have no button of their own (ADR-012). It opens
   * upwards inside the sidebar: the chrome cannot draw over the page view.
   */
  const ITEMS: CommandId[] = ["open-passwords", "open-boosts", "open-extensions", "open-archive"];

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let toggle: HTMLElement | undefined = $state();

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

  $effect(() => {
    if (open) root?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  });
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="tools" bind:this={root} onkeydown={onKey} role="presentation">
  {#if open}
    <Menu class="tools-menu" label="Outils">
      {#each ITEMS as id (id)}
        {@const command = getCommand(id)}
        <MenuItem role="menuitem" icon={command.icon} iconSize={15} label={command.label} title={platform.tip(command.label, id)} onclick={() => run(id)} />
      {/each}
    </Menu>
  {/if}
  <IconButton
    bind:element={toggle}
    icon="more"
    active={open}
    label="Outils"
    aria-haspopup="menu"
    aria-expanded={open}
    title="Mots de passe, Boosts, Extensions, Onglets archivés"
    onclick={() => (open = !open)}
  />
</div>

<style>
  .tools {
    position: relative;
    display: flex;
  }
  .tools :global(.tools-menu) {
    position: absolute;
    right: 0;
    bottom: calc(100% + 6px);
    z-index: 20;
    gap: 1px;
    min-width: 190px;
    max-width: calc(var(--sidebar-width) - 16px);
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / 0.5);
  }
</style>
