<script lang="ts">
  import type { ExtensionInfo } from "@shared/extensions";
  import type { Bounds } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import { dismiss } from "../components/ui/dismiss";
  import Button from "../components/ui/Button.svelte";
  import Icon from "../components/Icon.svelte";

  /**
   * After an install from this window (ADR-049): a short confirmation hanging from the extension
   * bar's puzzle button, as Chrome shows one. New extensions wait in the puzzle menu; "Épingler"
   * puts the button in the sidebar's row. Closes by itself after a while, by Escape or a click outside.
   */
  let { extensionId, anchor, onClose }: { extensionId: string; anchor?: Bounds; onClose: (restoreFocus: boolean) => void } = $props();

  const WIDTH = 300;
  const MARGIN = 8;
  const LINGER_MS = 8000;

  let extension = $state<ExtensionInfo | null>(null);
  let pinButton = $state<HTMLButtonElement>();

  $effect(() => {
    void api.extensions.list().then(
      (list) => (extension = list.find((entry) => entry.id === extensionId) ?? null),
      () => null,
    );
  });
  $effect(() => pinButton?.focus());
  $effect(() => {
    const timer = setTimeout(() => onClose(true), LINGER_MS);
    return () => clearTimeout(timer);
  });

  const left = $derived(Math.max(MARGIN, Math.min(anchor?.x ?? MARGIN, window.innerWidth - WIDTH - MARGIN)));
  const top = $derived(Math.max(MARGIN, (anchor ? anchor.y + anchor.height : 0) + MARGIN));

  function pin(): void {
    api.extensions.setPinned(extensionId, true);
    onClose(true);
  }
</script>

<div
  use:dismiss={{ onDismiss: () => onClose(true) }}
  class="popover"
  role="dialog"
  aria-label="Extension ajoutée"
  data-testid="extension-installed"
  style:left="{left}px"
  style:top="{top}px"
  style:width="{Math.min(WIDTH, window.innerWidth - 2 * MARGIN)}px"
>
  {#if extension}
    <header>
      <span class="badge">
        {#if extension.icon}<img src={extension.icon} alt="" />{:else}<Icon name="extension" size={16} />{/if}
      </span>
      <h2>« {extension.name} » a été ajoutée</h2>
    </header>
    <p>
      {#if extension.action && !extension.pinned}
        Retrouvez-la sous la pièce de puzzle, ou épinglez son bouton dans la barre latérale.
      {:else if extension.action}
        Son bouton est dans la barre latérale, sous la barre d'adresse.
      {:else}
        Elle s'applique aux pages ; gérez-la depuis la page Extensions.
      {/if}
    </p>
    <div class="actions">
      <Button variant="quiet" onclick={() => onClose(true)}>OK</Button>
      {#if extension.action && !extension.pinned}
        <Button variant="primary" icon="pin" bind:element={pinButton} onclick={pin}>Épingler</Button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .popover {
    position: fixed;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55);
    animation: pop var(--motion-base) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--space-5);
    height: var(--space-5);
    color: var(--text-muted);
  }
  .badge img {
    width: var(--space-5);
    height: var(--space-5);
    object-fit: contain;
  }
  h2 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.45;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(calc(-1 * var(--space-1)));
    }
  }
</style>
