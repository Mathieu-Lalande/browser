<script lang="ts">
  import { t } from "@shared/i18n";
  import type { SiteInfo } from "@shared/site-info";
  import type { Bounds, TabId } from "@shared/types";
  import { api, browser } from "../lib/browser.svelte";
  import { dismiss } from "../components/ui/dismiss";
  import Icon from "../components/Icon.svelte";
  import "../styles/kit.css";
  import ConnectionSection from "./site-info/ConnectionSection.svelte";
  import SiteBoostSection from "./site-info/SiteBoostSection.svelte";
  import SiteDataSection from "./site-info/SiteDataSection.svelte";
  import SiteInfoHeader from "./site-info/SiteInfoHeader.svelte";
  import TabControlsSection from "./site-info/TabControlsSection.svelte";
  import SitePrivacySection from "./site-info/SitePrivacySection.svelte";

  /**
   * Site info popover (ADR-021), hanging below the address bar's lock: connection and certificate,
   * cookies and site data, permissions, shields and zoom of the tab's site, its boost. Main reads
   * everything from the tab (its URL and session): this page only names the tab. Each part is a
   * component of `./site-info/`.
   */
  let { anchor, tabId, onClose }: { anchor?: Bounds; tabId: TabId; onClose: (restoreFocus: boolean) => void } = $props();

  const WIDTH = 340;
  const MARGIN = 8;

  let panel = $state<HTMLElement>();
  let innerWidth = $state(window.innerWidth);
  let innerHeight = $state(window.innerHeight);
  let info = $state<SiteInfo | null>(null);
  let loaded = $state(false);

  /** Shields and zoom follow the live tab state (the page reloads, the zoom changes…). */
  const tab = $derived(browser.state.tabs.find((item) => item.id === tabId));
  const secure = $derived(info?.connection === "https");

  const position = $derived.by(() => {
    const box = anchor ?? { x: MARGIN, y: MARGIN, width: 0, height: 0 };
    const top = Math.max(MARGIN, box.y + box.height + 6);
    const left = Math.max(MARGIN, Math.min(box.x - 6, innerWidth - WIDTH - MARGIN));
    return { left, top, maxHeight: Math.max(200, innerHeight - top - MARGIN) };
  });

  $effect(() => {
    void api.siteInfo.get(tabId).then(
      (next) => ((info = next), (loaded = true)),
      () => (loaded = true),
    );
  });
  $effect(() => panel?.focus());
</script>

<!-- Escape is heard on the window (use:dismiss): a button that just went away (confirmed action) leaves the focus on the page body. -->
<svelte:window bind:innerWidth bind:innerHeight />

<div
  bind:this={panel}
  use:dismiss={{ onDismiss: () => onClose(true) }}
  class="panel kit"
  role="dialog"
  aria-label={t("siteInfoPanel.siteInfo")}
  tabindex="-1"
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:max-height="{position.maxHeight}px"
  style:width="{Math.min(WIDTH, innerWidth - 2 * MARGIN)}px"
>
  {#if info}
    <SiteInfoHeader host={info.host} {secure} />
    <div class="body">
      <ConnectionSection certificate={info.certificate} {secure} />
      <SiteDataSection {info} {tabId} onUpdate={(next) => (info = next)} />
      {#if tab}<TabControlsSection {tab} defaultZoom={info.defaultZoom} />{/if}
      <SitePrivacySection {info} {tabId} onUpdate={(next) => (info = next)} {onClose} />
      <SiteBoostSection {tabId} {onClose} />
      {#if info.isPrivate}
        <p class="kit-hint private"><Icon name="mask" size={12} /> {t("siteInfoPanel.privateWindowTheseSettings")}</p>
      {/if}
    </div>
  {:else if loaded}
    <p class="empty">{t("siteInfoPanel.noInformationPage")}</p>
  {/if}
</div>

<style>
  .panel {
    position: fixed;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55),
      0 4px 14px -6px rgb(0 0 0 / 0.35);
    outline: none;
    animation: pop 0.16s var(--ease);
    transform-origin: top left;
  }
  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
  }
  .private {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px 12px;
  }
  .empty {
    margin: 0;
    padding: 18px;
    color: var(--text-muted);
    text-align: center;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.98);
    }
  }
</style>
