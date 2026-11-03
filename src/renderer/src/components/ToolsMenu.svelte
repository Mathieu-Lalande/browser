<script lang="ts">
  import { getCommand, type CommandId } from "@shared/commands";
  import { toolsMenuGroups } from "@shared/menus";
  import { api, browser } from "../lib/browser.svelte";
  import { platform } from "../lib/platform.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import Menu from "./ui/Menu.svelte";
  import MenuItem from "./ui/MenuItem.svelte";
  import { dismiss } from "./ui/dismiss";

  /**
   * Sidebar footer menu to the internal pages that have no button of their own (ADR-012), in the
   * order of the app menu (`toolsMenuGroups`). It opens upwards inside the sidebar: the chrome
   * cannot draw over the page view.
   */
  const groups = $derived(toolsMenuGroups(browser.isPrivate));

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let toggle: HTMLElement | undefined = $state();

  function run(id: CommandId): void {
    open = false;
    api.commands.run(id);
  }

  /** Escape (from inside the menu) closes it back to its button; a press outside just closes it. */
  function onDismiss(reason: "escape" | "outside"): void {
    open = false;
    if (reason === "escape") toggle?.focus();
  }

  $effect(() => {
    if (open) root?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  });
</script>

<div class="tools" bind:this={root} use:dismiss={{ enabled: open, escape: "node", outside: true, onDismiss }}>
  {#if open}
    <Menu class="tools-menu" label="Outils">
      {#each groups as group, index (index)}
        {#if index}<div class="separator" role="separator"></div>{/if}
        {#each group as id (id)}
          {@const command = getCommand(id)}
          <MenuItem role="menuitem" icon={command.icon} iconSize={15} label={command.label} title={platform.tip(command.label, id)} onclick={() => run(id)} />
        {/each}
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
    title="Mots de passe, extensions, notes, onglets archivés et autres pages"
    onclick={() => (open = !open)}
  />
</div>

<style>
  /* The menu is placed against the sidebar footer (its containing block), not this button. */
  .tools {
    display: flex;
  }
  .separator {
    height: 1px;
    margin: var(--space-1) var(--space-2);
    background: var(--border);
  }
  .tools :global(.tools-menu) {
    position: absolute;
    right: 0;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 20;
    gap: 1px;
    max-height: 70vh;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / 0.5);
  }
</style>
