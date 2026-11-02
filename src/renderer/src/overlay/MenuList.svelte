<script lang="ts">
  import type { Snippet } from "svelte";
  import { getCommand } from "@shared/commands";
  import { nodeLabel, type MenuNode } from "@shared/menus";
  import { platform } from "../lib/platform.svelte";
  import Icon from "../components/Icon.svelte";
  import Menu from "../components/ui/Menu.svelte";
  import MenuItem from "../components/ui/MenuItem.svelte";
  import MenuList from "./MenuList.svelte";

  /**
   * One level of a menu built from `@shared/menus` nodes (ADR-033), in the overlay layer. Arrow
   * keys walk the rows (`Menu`); a submenu opens beside its row on hover, click, → or Enter, and
   * ← or Escape closes it, back on its row. Submenus are siblings of this level's `Menu` (never
   * inside it), so each level's arrow keys stay in that level.
   */
  interface Props {
    nodes: MenuNode[];
    label: string;
    onRun: (node: MenuNode) => void;
    /** ← / Escape in a submenu: back to the parent row (undefined at the top level). */
    onBack?: () => void;
    /** Rows the caller draws itself (sync header, zoom row). */
    special?: Snippet<[MenuNode]>;
    /** Focus the first row once shown (a submenu opened from the keyboard). */
    autofocus?: boolean;
    class?: string;
    style?: string;
  }

  let { nodes, label, onRun, onBack, special, autofocus = false, class: className, style }: Props = $props();

  let element = $state<HTMLElement>();
  /** The open submenu and where it hangs. */
  let open = $state<{ id: string; top: number; left: number; keyboard: boolean } | null>(null);
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;

  const SUBMENU_WIDTH = 280;

  $effect(() => {
    if (autofocus) element?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  });

  function openSubmenu(id: string, row: HTMLElement, keyboard: boolean): void {
    const rect = row.getBoundingClientRect();
    const fits = rect.right + 4 + SUBMENU_WIDTH <= window.innerWidth - 8;
    const left = fits ? rect.right + 4 : Math.max(8, rect.left - SUBMENU_WIDTH - 4);
    open = { id, top: Math.max(8, rect.top - 5), left, keyboard };
  }

  function rowOf(id: string): HTMLElement | null {
    return element?.querySelector<HTMLElement>(`[data-node="${id}"]`) ?? null;
  }

  function closeSubmenu(): void {
    const id = open?.id;
    open = null;
    if (id) rowOf(id)?.focus();
  }

  function onPointerEnter(node: MenuNode, event: PointerEvent): void {
    clearTimeout(hoverTimer);
    const row = event.currentTarget as HTMLElement;
    // A short delay: crossing rows on the way to an open submenu does not close it.
    hoverTimer = setTimeout(() => {
      if (node.kind === "submenu" && node.enabled !== false) openSubmenu(node.id, row, false);
      else open = null;
    }, 120);
  }

  function onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const id = target.dataset.node;
    const node = nodes.find((candidate) => "id" in candidate && candidate.id === id);
    if ((event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") && node?.kind === "submenu") {
      event.preventDefault();
      event.stopPropagation();
      openSubmenu(node.id, target, true);
    } else if ((event.key === "ArrowLeft" || event.key === "Escape") && onBack) {
      event.preventDefault();
      event.stopPropagation();
      onBack();
    }
  }

  const submenu = $derived(open ? nodes.find((node) => node.kind === "submenu" && node.id === open!.id) : undefined);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class={["level", className]} {style} onkeydown={onKeydown} onpointerleave={() => clearTimeout(hoverTimer)}>
  <Menu bind:element {label}>
    {#each nodes as node, index (index)}
      {#if node.kind === "separator"}
        <div class="separator" role="separator"></div>
      {:else if node.kind === "sync" || node.kind === "zoom"}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div onpointerenter={(event) => onPointerEnter(node, event)}>{@render special?.(node)}</div>
      {:else if node.kind === "submenu"}
        <MenuItem
          role="menuitem"
          icon={node.icon}
          label={node.label}
          data-node={node.id}
          aria-haspopup="menu"
          aria-expanded={open?.id === node.id}
          disabled={node.enabled === false}
          data-open={open?.id === node.id}
          onpointerenter={(event) => onPointerEnter(node, event)}
          onclick={(event) => openSubmenu(node.id, event.currentTarget as HTMLElement, event.detail === 0)}
        >
          <span class="chevron"><Icon name="chevron-right" size={14} /></span>
        </MenuItem>
      {:else if node.kind === "command"}
        <MenuItem
          role={node.checked === undefined ? "menuitem" : "menuitemcheckbox"}
          aria-checked={node.checked}
          icon={node.checked ? "check" : getCommand(node.id).icon}
          label={nodeLabel(node)}
          keys={platform.shortcut(node.id)}
          data-node={node.id}
          disabled={node.enabled === false}
          onpointerenter={(event) => onPointerEnter(node, event)}
          onclick={() => onRun(node)}
        />
      {:else}
        <MenuItem
          role="menuitem"
          icon={node.kind === "link" ? "globe" : (node.icon ?? "more")}
          label={node.label}
          keys={node.kind === "action" ? node.hint : undefined}
          title={node.kind === "link" ? node.url : undefined}
          data-node={node.id}
          disabled={node.kind === "action" && node.enabled === false}
          onpointerenter={(event) => onPointerEnter(node, event)}
          onclick={() => onRun(node)}
        />
      {/if}
    {/each}
  </Menu>
</div>

{#if open && submenu?.kind === "submenu"}
  <MenuList
    nodes={submenu.children}
    label={submenu.label}
    {onRun}
    onBack={closeSubmenu}
    autofocus={open.keyboard}
    class="submenu"
    style="top: {open.top}px; left: {open.left}px; width: {SUBMENU_WIDTH}px; max-height: {window.innerHeight - open.top - 8}px"
  />
{/if}

<style>
  .level :global(.menu) {
    padding: 4px;
  }
  .level :global(.item:disabled) {
    opacity: 0.45;
  }
  .level :global(.item[data-open="true"]) {
    background: var(--surface-hover);
  }
  .chevron {
    display: grid;
    color: var(--text-faint);
  }
  .separator {
    height: 1px;
    margin: 4px 8px;
    background: var(--border);
  }
  :global(.level.submenu) {
    position: fixed;
    z-index: 1;
    overflow: auto;
    border-radius: calc(var(--radius) + 4px);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55),
      0 4px 14px -6px rgb(0 0 0 / 0.35);
    animation: pop var(--motion-fast, 0.12s) var(--ease);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateX(-4px);
    }
  }
</style>
