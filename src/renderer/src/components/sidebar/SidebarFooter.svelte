<script lang="ts">
  import type { SpaceId } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import { updates } from "../../lib/updates.svelte";
  import DownloadsButton from "../downloads/DownloadsButton.svelte";
  import SpaceSwitcher from "../spaces/SpaceSwitcher.svelte";
  import ToolsMenu from "../ToolsMenu.svelte";
  import IconButton from "../ui/IconButton.svelte";

  /**
   * Bottom of the sidebar: the space switcher (its indicator follows a swipe: `progress`,
   * `following`), then updates, downloads, tools and settings.
   */
  let { onEditSpace, progress, following }: { onEditSpace: (id: SpaceId) => void; progress: number; following: boolean } = $props();
</script>

<footer class="footer">
  {#if browser.isPrivate}
    <!-- One ephemeral space per private window: no switcher (ADR-014). -->
    <p class="private-hint" title="Cookies, cache et données de sites sont effacés à la fermeture de la fenêtre">
      Effacée à la fermeture
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
  <ToolsMenu />
  <IconButton icon="settings" label="Paramètres" command="open-settings" onclick={() => api.settings.open()} />
</footer>

<style>
  .footer {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    min-width: 0;
    margin-top: auto;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .private-hint {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding-left: 6px;
    overflow: hidden;
    color: var(--text-faint);
    font-size: 11.5px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
