<script lang="ts">
  import Icon from "../Icon.svelte";

  /** A source's artwork (a data: URL main fetched, ADR-035), else a neutral audio glyph. */
  let { src, size = "md" }: { src: string | null; size?: "sm" | "md" } = $props();
</script>

<span class={["artwork", size]} aria-hidden="true">
  {#if src}<img {src} alt="" draggable="false" />{:else}<Icon name="audio-lines" size={size === "sm" ? 12 : 18} />{/if}
</span>

<style>
  .artwork {
    display: grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-active);
    color: var(--text-muted);
  }
  .artwork.md {
    width: calc(var(--space-6) + var(--space-2));
    height: calc(var(--space-6) + var(--space-2));
  }
  .artwork.sm {
    width: var(--space-5);
    height: var(--space-5);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
