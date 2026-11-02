<script lang="ts">
  import { platform } from "../../lib/platform.svelte";

  /** Keyboard hints. The less common ones hide on a narrow window. */
  const mod = $derived(platform.isMac ? "⌘" : "Ctrl");
  const alt = $derived(platform.isMac ? "⌥" : "Alt");
</script>

<footer>
  <span><kbd>↑</kbd><kbd>↓</kbd> Naviguer</span>
  <span><kbd>↵</kbd> Ouvrir</span>
  <span><kbd>Tab</kbd> Compléter</span>
  <span class="wide"><kbd>{mod}</kbd><kbd>↵</kbd> Nouvel onglet</span>
  <span class="wide"><kbd>Maj</kbd><kbd>↵</kbd> Côte à côte</span>
  <span class="wide"><kbd>{alt}</kbd><kbd>↵</kbd> Arrière-plan</span>
  <span class="spacer"></span>
  <span><kbd>Échap</kbd></span>
</footer>

<style>
  footer {
    display: flex;
    flex: none;
    align-items: center;
    gap: 14px;
    padding: 8px 14px;
    overflow: hidden;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 11.5px;
    white-space: nowrap;
  }
  span {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--surface);
    color: var(--text-muted);
    font: 500 10.5px/1 var(--font);
  }
  .spacer {
    flex: 1;
  }
  @media (max-width: 760px) {
    .wide {
      display: none;
    }
  }
</style>
