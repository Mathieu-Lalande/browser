<script lang="ts">
  import { api } from "../lib/browser.svelte";
  import Icon from "./Icon.svelte";

  /**
   * Windows/Linux window buttons (the window is frameless there): minimize, maximize/restore and
   * close, in the standard order. macOS keeps its native traffic lights instead.
   */
  let maximized = $state(false);

  $effect(() => {
    api.window.isMaximized().then(
      (value) => (maximized = value),
      () => {},
    );
    return api.window.onMaximizedChange((value) => (maximized = value));
  });
</script>

<div class="controls no-drag" role="group" aria-label="Fenêtre">
  <button aria-label="Réduire" title="Réduire" onclick={() => api.window.minimize()}>
    <Icon name="minimize" size={16} />
  </button>
  <button
    aria-label={maximized ? "Restaurer" : "Agrandir"}
    title={maximized ? "Restaurer" : "Agrandir"}
    onclick={() => api.window.toggleMaximize()}
  >
    <Icon name={maximized ? "restore" : "maximize"} size={maximized ? 13 : 12} />
  </button>
  <button class="close" aria-label="Fermer la fenêtre" title="Fermer" onclick={() => api.window.close()}>
    <Icon name="close" size={16} />
  </button>
</div>

<style>
  .controls {
    display: flex;
    flex: none;
    gap: 2px;
  }
  button {
    display: grid;
    place-items: center;
    width: 36px;
    height: 30px;
    padding: 0;
    border-radius: 8px;
    color: var(--text-muted);
    transition:
      background 0.12s var(--ease),
      color 0.12s var(--ease);
  }
  button:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  button:active {
    background: var(--surface-active);
  }
  .close:hover,
  .close:focus-visible {
    background: #e5484d;
    color: #fff;
  }
  .close:active {
    background: #c9373c;
  }
  button:focus-visible {
    outline-offset: -2px;
  }
</style>
