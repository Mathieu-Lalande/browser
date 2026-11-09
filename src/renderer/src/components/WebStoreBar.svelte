<script lang="ts">
  import { extensionsUi } from "../lib/extensions.svelte";
  import Button from "./ui/Button.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import Icon from "./Icon.svelte";

  /**
   * Chrome Web Store banner (ADR-049), above an extension's store page: "Ajouter à Browser". Like
   * the permission bar it shrinks the viewport (the store page itself is never modified), and it
   * stays out of the overlay, which takes focus and is meant for brief popovers.
   */
  let { webStoreId }: { webStoreId: string } = $props();

  let dismissed = $state<string | null>(null);
  const notice = $derived(extensionsUi.notice?.webStoreId === webStoreId ? extensionsUi.notice : null);
  const busy = $derived(extensionsUi.installing === webStoreId);
  const offer = $derived(extensionsUi.storeCandidate === webStoreId);
</script>

{#if dismissed !== webStoreId && (offer || notice)}
  <div class="store-bar" role="status" aria-label="Chrome Web Store" data-testid="webstore-bar">
    <Icon name={notice?.kind === "error" ? "warning" : notice ? "check" : "extension"} size={15} />
    <p class:error={notice?.kind === "error"}>
      {#if notice}
        {notice.text}
      {:else if busy}
        Téléchargement et vérification de l'extension…
      {:else}
        <strong>Extension du Chrome Web Store</strong>
        <span>Elle peut être installée dans Browser.</span>
      {/if}
    </p>
    {#if offer}
      <Button variant="primary" size="sm" icon="plus" disabled={busy} onclick={() => extensionsUi.installFromStore(webStoreId)}>Ajouter à Browser</Button>
    {/if}
    <IconButton size="row" icon="close" iconSize={14} label="Masquer" onclick={() => (dismissed = webStoreId)} />
  </div>
{/if}

<style>
  .store-bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-3);
    min-height: calc(var(--hit-min) + var(--space-3));
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-muted);
  }
  p {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    min-width: 0;
    margin: 0;
    color: var(--text);
    font-size: var(--text-sm);
  }
  p span {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  p.error {
    color: var(--danger-text);
  }
</style>
