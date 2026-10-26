<script lang="ts">
  import { api } from "../lib/browser.svelte";
</script>

<div class="controls no-drag">
  <button class="close" aria-label="Fermer la fenêtre" onclick={() => api.window.close()}></button>
  <button class="minimize" aria-label="Réduire" onclick={() => api.window.minimize()}></button>
  <button class="maximize" aria-label="Agrandir" onclick={() => api.window.toggleMaximize()}></button>
</div>

<style>
  .controls {
    display: flex;
    gap: 8px;
    padding-left: 8px;
  }
  button {
    width: 12px;
    height: 12px;
    padding: 0;
    border-radius: 50%;
    background: var(--surface-active);
    transition: background 0.12s var(--ease);
  }
  .controls:hover .close {
    background: #ff5f57;
  }
  .controls:hover .minimize {
    background: #febc2e;
  }
  .controls:hover .maximize {
    background: #28c840;
  }
</style>
