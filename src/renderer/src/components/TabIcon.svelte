<script lang="ts">
  import { internalPageOf } from "@shared/internal";
  import type { TabState } from "@shared/types";
  import Favicon from "./Favicon.svelte";
  import Icon, { type IconName } from "./Icon.svelte";

  let { tab }: { tab: TabState } = $props();

  // Internal pages have no favicon: they get the icon of their section.
  const INTERNAL_ICONS: Record<string, IconName> = { settings: "settings", downloads: "download", archive: "archive", extensions: "extension" };
  const internal = $derived(internalPageOf(tab.url));
</script>

{#if internal}
  <span class="internal"><Icon name={INTERNAL_ICONS[internal]} size={16} /></span>
{:else}
  <Favicon src={tab.favicon} loading={tab.isLoading} />
{/if}

<style>
  .internal {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    color: var(--text-muted);
  }
</style>
