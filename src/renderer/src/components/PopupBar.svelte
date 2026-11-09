<script lang="ts">
  import { t } from "@shared/i18n";
  import type { TabId, TabState } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import Icon from "./Icon.svelte";

  /**
   * Popup blocker notice (ADR-018): a page tried to open a window without a user gesture. Like the
   * permission bar, it shrinks the viewport (nothing can be drawn over the native page view).
   */
  let { tabId, popup }: { tabId: TabId; popup: NonNullable<TabState["blockedPopup"]> } = $props();

  const target = $derived.by(() => {
    try {
      const url = new URL(popup.url);
      return url.protocol === "about:" ? popup.url : url.host;
    } catch {
      return popup.url;
    }
  });
</script>

<div class="popup-bar" role="status" aria-label={t("popupBar.popUpBlocked")}>
  <Icon name="window" size={15} />
  <p>
    <strong>{t("popupBar.popUpBlocked")}</strong>
    <span class="target" title={popup.url}>{target}{#if popup.count > 1}{t("popupBar.attempts", { count: popup.count })}{/if}</span>
  </p>
  <button class="primary" onclick={() => api.tabs.openBlockedPopup(tabId)}>{t("popupBar.open")}</button>
  <button class="dismiss" aria-label={t("popupBar.ignore")} title={t("popupBar.ignore")} onclick={() => api.tabs.dismissBlockedPopup(tabId)}>
    <Icon name="close" size={14} />
  </button>
</div>

<style>
  .popup-bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 5px 6px 5px 14px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-muted);
    animation: drop 0.18s var(--ease);
  }
  p {
    display: flex;
    flex: 1;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
    margin: 0;
    color: var(--text);
  }
  .target {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    height: 28px;
    border-radius: 8px;
    font-weight: 500;
  }
  .primary {
    padding: 0 14px;
    background: var(--accent);
    color: #fff;
  }
  .primary:hover {
    background: color-mix(in oklab, var(--accent) 85%, #fff);
  }
  .dismiss {
    display: grid;
    place-items: center;
    width: 28px;
    color: var(--text-muted);
  }
  .dismiss:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
</style>
