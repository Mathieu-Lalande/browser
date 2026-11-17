<script lang="ts">
  import { t } from "@shared/i18n";
  import { focusMinutesLeft } from "@shared/focus";
  import type { SpaceId } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import { updates } from "../../lib/updates.svelte";
  import DownloadsButton from "../downloads/DownloadsButton.svelte";
  import Icon from "../Icon.svelte";
  import SpaceSwitcher from "../spaces/SpaceSwitcher.svelte";
  import IconButton from "../ui/IconButton.svelte";

  /**
   * Bottom of the sidebar: the space switcher (its indicator follows a swipe: `progress`,
   * `following`), then updates, downloads, settings and the app menu (ADR-045: the one "…" menu
   * of the window, opening upwards in the overlay layer).
   */
  let { onEditSpace, progress, following }: { onEditSpace: (id: SpaceId) => void; progress: number; following: boolean } = $props();
  let appMenuButton = $state<HTMLElement>();

  let now = $state(Date.now());
  $effect(() => {
    if (!browser.state.focus?.until) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(timer);
  });
  const focusLeft = $derived(browser.state.focus ? focusMinutesLeft(browser.state.focus, now) : 0);

  function showAppMenu(): void {
    const rect = appMenuButton?.getBoundingClientRect();
    if (rect) api.appMenu.show({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
</script>

<footer class="footer">
  {#if browser.isPrivate}
    <!-- One ephemeral space per private window: no switcher (ADR-014). -->
    <p class="private-hint" title={t("sidebarFooter.privateBrowsingCookiesCache")}>
      <Icon name="mask" size={14} />
      <span>{t("sidebarFooter.privateBrowsing")}</span>
    </p>
  {:else}
    <SpaceSwitcher onEdit={onEditSpace} {progress} {following} />
  {/if}
  {#if focusLeft}
    <!-- A focus session runs (ADR-059): minutes left; a click shows the Concentration page. -->
    <button type="button" class="focus-chip" data-testid="focus-chip" title={t("sidebarFooter.focusRunning", { left: focusLeft })} onclick={() => api.commands.run("open-focus")}>
      <Icon name="hourglass" size={13} /> <span>{focusLeft}′</span>
    </button>
  {/if}
  {#if updates.ready}
    <!-- A downloaded update (ADR-030): discreet, and also installed on quit anyway. -->
    <IconButton
      icon="update"
      on
      label={t("sidebarFooter.restartUpdate")}
      title={t("sidebarFooter.restartUpdateVersion", { version: updates.status?.version })}
      onclick={() => api.updates.install()}
    />
  {/if}
  <DownloadsButton />
  <IconButton icon="settings" label={t("sidebarFooter.settings")} command="open-settings" onclick={() => api.settings.open()} />
  <IconButton
    bind:element={appMenuButton}
    icon="more"
    label={t("sidebarFooter.appMenu")}
    title={t("sidebarFooter.menuHistoryBookmarksPasswords")}
    aria-haspopup="menu"
    data-testid="app-menu-button"
    onclick={showAppMenu}
  />
</footer>

<style>
  .footer {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    min-width: 0;
    margin-top: auto;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .focus-chip {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    height: 24px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: var(--on-accent);
    font-size: var(--text-xs);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  /* A private window says so at a glance (the title bar that carried the badge folds away). */
  .private-hint {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin: 0;
    padding-left: 6px;
    overflow: hidden;
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  .private-hint span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
