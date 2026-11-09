<script lang="ts">
  import { t } from "@shared/i18n";
  import { PANEL_WIDTH, clampPanelWidth, panelLabel, type PanelView } from "@shared/panels";
  import { api } from "../../lib/browser.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import PanelIcon from "./PanelIcon.svelte";

  /**
   * The frame of the web panel shown beside the page (ADR-047, ADR-010: it narrows the viewport,
   * the panel's page is a native view main places in `.body`). Its inner edge resizes it; the width
   * is saved on release (`panels.setWidth`), the page follows frame by frame meanwhile.
   */
  let { panel, side }: { panel: PanelView; side: "left" | "right" } = $props();

  const KEY_STEP = 16;
  let body: HTMLElement;
  let width = $state(0);
  let drag: { x: number; width: number } | null = null;

  $effect(() => {
    width = panel.width;
  });

  // The page view follows `.body`: at most one bounds update per frame (resize, sidebar slides…).
  $effect(() => {
    let frame = 0;
    let last = "";
    const send = () => {
      frame = 0;
      const rect = body.getBoundingClientRect();
      const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      const key = JSON.stringify(bounds);
      if (key === last) return;
      last = key;
      api.panels.setBounds(bounds);
    };
    const report = () => {
      if (!frame) frame = requestAnimationFrame(send);
    };
    const observer = new ResizeObserver(report);
    observer.observe(body);
    // A move without a resize (the sidebar shown or hidden) resizes the row around the panel.
    if (body.parentElement?.parentElement) observer.observe(body.parentElement.parentElement);
    window.addEventListener("resize", report);
    send();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", report);
      api.panels.setBounds(null);
    };
  });

  /** The panel never takes more than half of the window. */
  const clamp = (value: number) => Math.min(clampPanelWidth(value), Math.max(PANEL_WIDTH.min, Math.floor(window.innerWidth / 2)));

  function onPointerDown(event: PointerEvent & { currentTarget: HTMLElement }): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, width };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag) return;
    const delta = event.clientX - drag.x;
    width = clamp(drag.width + (side === "left" ? delta : -delta));
  }

  function onPointerUp(): void {
    if (!drag) return;
    drag = null;
    api.panels.setWidth(panel.id, width);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const grow = (event.key === "ArrowRight") === (side === "left");
    width = clamp(width + (grow ? KEY_STEP : -KEY_STEP));
    api.panels.setWidth(panel.id, width);
  }

  const label = $derived(panelLabel(panel));
</script>

<aside class="web-panel" class:right={side === "right"} style:width="{width}px" aria-label={t("webPanelFrame.panel", { label })} data-testid="web-panel">
  <header>
    <PanelIcon {panel} />
    <h2>{label}</h2>
    <IconButton
      size="sm"
      icon="smartphone"
      iconSize={14}
      label={t("webPanelFrame.mobileSite")}
      pressed={panel.mobile}
      onclick={() => api.panels.setMobile(panel.id, !panel.mobile)}
    />
    <IconButton size="sm" icon="reload" iconSize={14} label={t("webPanelFrame.reloadPanel")} onclick={() => api.panels.reload(panel.id)} />
    <IconButton size="sm" icon="close" iconSize={14} label={t("webPanelFrame.hidePanel")} command="toggle-web-panel" onclick={() => api.panels.close()} />
  </header>
  <div class="body" bind:this={body}></div>
  <!-- A focusable separator is the standard pattern for a resizable splitter (arrow keys resize it). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="handle"
    role="separator"
    aria-orientation="vertical"
    aria-label={t("webPanelFrame.panelWidth")}
    aria-valuenow={width}
    aria-valuemin={PANEL_WIDTH.min}
    aria-valuemax={PANEL_WIDTH.max}
    tabindex="0"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onkeydown={onKeydown}
  ></div>
</aside>

<style>
  .web-panel {
    position: relative;
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    max-width: 50vw;
    padding: var(--space-1);
    border-radius: var(--page-radius, var(--radius-md));
    background: var(--bg-elevated);
    box-shadow: var(--viewport-shadow);
    animation: rise var(--motion-base) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-1);
  }
  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .body {
    flex: 1;
    min-height: 0;
    border-radius: var(--radius-md);
  }
  .handle {
    position: absolute;
    top: 0;
    right: calc(-1 * var(--space-1));
    bottom: 0;
    width: var(--space-2);
    cursor: col-resize;
  }
  .right .handle {
    right: auto;
    left: calc(-1 * var(--space-1));
  }
  .handle:hover,
  .handle:focus-visible {
    outline: none;
    background: color-mix(in oklab, var(--accent) 35%, transparent);
  }
</style>
