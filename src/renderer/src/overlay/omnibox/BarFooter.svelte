<script lang="ts">
  import { t } from "@shared/i18n";
  import { platform } from "../../lib/platform.svelte";

  /** Keyboard hints. Those that do not fit wrap onto a hidden second row (never cut mid-word). */
  const mod = $derived(platform.isMac ? "⌘" : "Ctrl");
  const alt = $derived(platform.isMac ? "⌥" : "Alt");
</script>

<footer>
  <div class="hints">
    <span><kbd>↑</kbd><kbd>↓</kbd> {t("barFooter.navigate")}</span>
    <span><kbd>↵</kbd> {t("barFooter.open")}</span>
    <span><kbd>{t("barFooter.tab")}</kbd> {t("barFooter.complete")}</span>
    <span><kbd>{mod}</kbd><kbd>↵</kbd> {t("barFooter.newTab")}</span>
    <span><kbd>{t("barFooter.shift")}</kbd><kbd>↵</kbd> {t("barFooter.sideSide")}</span>
    <span><kbd>{alt}</kbd><kbd>↵</kbd> {t("barFooter.background")}</span>
  </div>
  <span><kbd>{t("barFooter.esc")}</kbd></span>
</footer>

<style>
  footer {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  span {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 var(--space-1);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--surface);
    color: var(--text-muted);
    font: 500 10.5px/1 var(--font);
  }
  .hints {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
    min-width: 0;
    height: 18px;
    overflow: hidden;
  }
</style>
