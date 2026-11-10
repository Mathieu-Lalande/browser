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

  /** The title the extension set (ADR-053), else its manifest's, with the badge read out. */
  const titleOf = (extension: ExtensionInfo) => {
    const state = extensionsUi.actionOf(extension.id);
    const title = state.title || extension.action?.title || extension.name;
    return state.badgeText ? t("extensionBar.withBadge", { title, badge: state.badgeText }) : title;
  };

  /** Its popup, or `action.onClicked` when it has none (main decides, ADR-053). */
  function open(extension: ExtensionInfo, event: MouseEvent & { currentTarget: HTMLElement }): void {
    api.extensions.openPopup(extension.id, boundsOf(event.currentTarget));
  }

  function menu(id: string | null, event: MouseEvent & { currentTarget: HTMLElement }): void {
    event.preventDefault();
    api.extensions.menu(id, boundsOf(event.currentTarget));
  }
</script>

{#if !browser.isPrivate && extensionsUi.list.some((extension) => extension.enabled)}
  <div class="extension-bar" role="toolbar" aria-label={t("extensionBar.extensions")} data-testid="extension-bar">
    {#each visible as extension (extension.id)}
      {@const state = extensionsUi.actionOf(extension.id)}
      {@const icon = state.icon ?? extension.action?.icon}
      <IconButton
        size="sm"
        label={titleOf(extension)}
        title={titleOf(extension)}
        aria-disabled={state.enabled === false}
        class={state.enabled === false ? "inert" : undefined}
        data-extension-action={extension.id}
        onclick={(event) => open(extension, event)}
        oncontextmenu={(event) => menu(extension.id, event)}
      >
        {#if icon}
          <img src={icon} alt="" />
        {:else}
          <Icon name="extension" size={14} />
        {/if}
        {#if state.badgeText}
          <span
            class="badge"
            data-extension-badge={extension.id}
            style:background={state.badgeColor ?? null}
            style:color={state.badgeTextColor ?? null}
            aria-hidden="true">{state.badgeText}</span
          >
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
  :global(.extension-bar [data-extension-action]) {
    position: relative;
  }
  /* The badge an extension sets (chrome.action.setBadgeText, ADR-053), over the icon's corner. */
  .badge {
    position: absolute;
    right: calc(-1 * var(--space-1) / 2);
    bottom: calc(-1 * var(--space-1) / 2);
    min-width: var(--space-3);
    max-width: calc(var(--hit-min) + var(--space-2));
    overflow: hidden;
    padding: 0 calc(var(--space-1) / 2);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--on-accent);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: var(--space-3);
    text-align: center;
    pointer-events: none;
    white-space: nowrap;
  }
</style>
