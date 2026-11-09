<script lang="ts">
  import { panelLabel, type WebPanel } from "@shared/panels";

  /** A panel's icon: its favicon (`data:`, fetched by main), else the first letter of its name. */
  let { panel }: { panel: Pick<WebPanel, "favicon" | "title" | "url"> } = $props();

  let broken = $state(false);
  $effect(() => {
    void panel.favicon;
    broken = false;
  });
  const letter = $derived(panelLabel(panel).charAt(0).toUpperCase() || "?");
</script>

{#if panel.favicon && !broken}
  <img class="icon" src={panel.favicon} alt="" onerror={() => (broken = true)} />
{:else}
  <span class="icon letter" aria-hidden="true">{letter}</span>
{/if}

<style>
  .icon {
    width: 18px;
    height: 18px;
    border-radius: var(--radius-sm);
    object-fit: contain;
  }
  .letter {
    display: grid;
    place-items: center;
    background: color-mix(in oklab, var(--accent) 22%, transparent);
    color: var(--accent-text);
    font-size: var(--text-xs);
    font-weight: 700;
  }
</style>
