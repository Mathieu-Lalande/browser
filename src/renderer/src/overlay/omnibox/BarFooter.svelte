<script lang="ts">
  import { t } from "@shared/i18n";
  import { platform } from "../../lib/platform.svelte";

  /** Keyboard hints. The less common ones hide on a narrow window. */
  const mod = $derived(platform.isMac ? "⌘" : "Ctrl");
  const alt = $derived(platform.isMac ? "⌥" : "Alt");
</script>

<footer>
  <span><kbd>↑</kbd><kbd>↓</kbd> {t("barFooter.navigate")}</span>
  <span><kbd>↵</kbd> {t("barFooter.open")}</span>
  <span><kbd>{t("barFooter.tab")}</kbd> {t("barFooter.complete")}</span>
  <span class="wide"><kbd>{mod}</kbd><kbd>↵</kbd> {t("barFooter.newTab")}</span>
  <span class="wide"><kbd>{t("barFooter.shift")}</kbd><kbd>↵</kbd> {t("barFooter.sideSide")}</span>
  <span class="wide"><kbd>{alt}</kbd><kbd>↵</kbd> {t("barFooter.background")}</span>
  <span class="spacer"></span>
  <span><kbd>{t("barFooter.esc")}</kbd></span>
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
