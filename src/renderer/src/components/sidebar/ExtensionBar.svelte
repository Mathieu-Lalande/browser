<script lang="ts">
  import { t } from "@shared/i18n";
  import type { ExtensionInfo } from "@shared/extensions";
  import type { Bounds } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import { extensionsUi } from "../../lib/extensions.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Icon from "../Icon.svelte";

  /**
   * The extensions' toolbar buttons (ADR-049), a row under the address bar: the pinned ones (at
   * most MAX_VISIBLE), then the puzzle button, whose native menu lists them all (open, pin, manage).
   * A click opens the extension's popup below its button. None in a private window: extensions do
   * not run there.
   */
  const MAX_VISIBLE = 6;

  const visible = $derived(extensionsUi.withAction.filter((extension) => extension.pinned).slice(0, MAX_VISIBLE));
  const hidden = $derived(extensionsUi.withAction.length - visible.length);

  const boundsOf = (element: HTMLElement): Bounds => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };

  const titleOf = (extension: ExtensionInfo) =>
    extension.action?.hasPopup ? extension.action.title : t("extensionBar.noWindowOpenHere", { p: extension.action?.title ?? extension.name });

  function open(extension: ExtensionInfo, event: MouseEvent & { currentTarget: HTMLElement }): void {
    if (extension.action?.hasPopup) api.extensions.openPopup(extension.id, boundsOf(event.currentTarget));
  }

  function menu(id: string | null, event: MouseEvent & { currentTarget: HTMLElement }): void {
    event.preventDefault();
    api.extensions.menu(id, boundsOf(event.currentTarget));
  }
</script>

{#if !browser.isPrivate && extensionsUi.list.some((extension) => extension.enabled)}
  <div class="extension-bar" role="toolbar" aria-label={t("extensionBar.extensions")} data-testid="extension-bar">
    {#each visible as extension (extension.id)}
      <IconButton
        size="sm"
        label={extension.action?.title ?? extension.name}
        title={titleOf(extension)}
        aria-disabled={!extension.action?.hasPopup}
        class={extension.action?.hasPopup ? undefined : "inert"}
        data-extension-action={extension.id}
        onclick={(event) => open(extension, event)}
        oncontextmenu={(event) => menu(extension.id, event)}
      >
        {#if extension.action?.icon}
          <img src={extension.action.icon} alt="" />
        {:else}
          <Icon name="extension" size={14} />
        {/if}
      </IconButton>
    {/each}
    <div class="spacer"></div>
    <IconButton
      size="sm"
      icon="extension"
      iconSize={14}
      label={t("extensionBar.extensions")}
      title={hidden ? t("extensionBar.extensionsNotShown", { hidden }) : t("extensionBar.extensionsOpenPinManage")}
      aria-haspopup="menu"
      data-extensions-anchor
      onclick={(event) => menu(null, event)}
      oncontextmenu={(event) => menu(null, event)}
    />
  </div>
{/if}

<style>
  .extension-bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .spacer {
    flex: 1;
  }
  img {
    width: var(--space-4);
    height: var(--space-4);
    object-fit: contain;
  }
  :global(.extension-bar .inert) img {
    opacity: 0.55;
  }
</style>
