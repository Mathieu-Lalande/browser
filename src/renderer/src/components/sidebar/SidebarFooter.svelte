<script lang="ts">
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

  function showAppMenu(): void {
    const rect = appMenuButton?.getBoundingClientRect();
    if (rect) api.appMenu.show({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
</script>

<footer class="footer">
  {#if browser.isPrivate}
    <!-- One ephemeral space per private window: no switcher (ADR-014). -->
    <p class="private-hint" title="Navigation privée : cookies, cache et données de sites sont effacés à la fermeture de la fenêtre">
      <Icon name="mask" size={14} />
      <span>Navigation privée</span>
    </p>
  {:else}
    <SpaceSwitcher onEdit={onEditSpace} {progress} {following} />
  {/if}
  {#if updates.ready}
    <!-- A downloaded update (ADR-030): discreet, and also installed on quit anyway. -->
    <IconButton
      icon="update"
      on
      label="Redémarrer pour mettre à jour"
      title="Redémarrer pour mettre à jour (version {updates.status?.version})"
      onclick={() => api.updates.install()}
    />
  {/if}
  <DownloadsButton />
  <IconButton icon="settings" label="Paramètres" command="open-settings" onclick={() => api.settings.open()} />
  <IconButton
    bind:element={appMenuButton}
    icon="more"
    label="Menu de l'application"
    title="Menu : historique, favoris, mots de passe, extensions, outils, aide…"
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
