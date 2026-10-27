<script lang="ts">
  import Icon from "./Icon.svelte";

  let { src, loading = false }: { src: string | null; loading?: boolean } = $props();
  let broken = $state(false);

  $effect(() => {
    void src;
    broken = false;
  });
</script>

<span class="favicon" class:loading>
  {#if loading}
    <span class="spinner"></span>
  {:else if src && !broken}
    <img {src} alt="" onerror={() => (broken = true)} />
  {:else}
    <Icon name="globe" size={16} />
  {/if}
</span>

<style>
  .favicon {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    color: var(--text-muted);
  }
  img {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    object-fit: contain;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid color-mix(in oklab, var(--accent) 30%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
