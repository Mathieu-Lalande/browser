<script lang="ts">
  import { api } from "../../lib/browser.svelte";
  import { media } from "../../lib/media.svelte";
  import IconButton from "../ui/IconButton.svelte";

  /**
   * Compact mode (ADR-035): the mini-player folds to one button in the rail, playing or pausing the
   * most recent source (hovering the rail unfolds the sidebar and its full mini-player).
   */
  const top = $derived(media.shown[0]);
</script>

{#if top}
  <IconButton
    icon={top.playing ? "pause" : "play"}
    on={top.playing}
    disabled={!top.controllable}
    label="{top.playing ? 'Mettre en pause' : 'Lire'} : {top.title}"
    data-testid="media-rail"
    onclick={() => api.media.action(top.tabId, "toggle")}
  />
{/if}
