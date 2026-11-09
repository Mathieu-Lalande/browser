<script lang="ts">
  import { t } from "@shared/i18n";
  import { extensionsUi } from "../lib/extensions.svelte";
  import Button from "./ui/Button.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import Icon from "./Icon.svelte";

  /**
   * Chrome Web Store failures (ADR-049), above the store page: why "Ajouter à Browser" failed, with
   * "Réessayer". Installing itself is our button inside the store page (and the address bar's); this
   * bar only shows when something went wrong, so the reason stays readable even if the store's
   * layout changed and our in-page button could not be placed. Like the permission bar it shrinks
   * the viewport (the overlay takes focus and is meant for brief popovers).
   */
  let { webStoreId }: { webStoreId: string } = $props();

  let dismissed = $state<string | null>(null);
  const failure = $derived(extensionsUi.pageInstall?.phase === "error" ? extensionsUi.pageInstall.message : null);
</script>

{#if failure && dismissed !== failure}
  <div class="store-bar" role="alert" aria-label="Chrome Web Store" data-testid="webstore-bar">
    <Icon name="warning" size={15} />
    <p>{failure}</p>
    <Button size="sm" icon="reload" onclick={() => extensionsUi.installFromStore(webStoreId)}>{t("webStoreBar.tryAgain")}</Button>
    <IconButton size="row" icon="close" iconSize={14} label={t("webStoreBar.hide")} onclick={() => (dismissed = failure)} />
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
    color: var(--danger-text);
  }
  p {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--text-sm);
  }
</style>
