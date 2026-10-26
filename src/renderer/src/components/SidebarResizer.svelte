<script lang="ts">
  import { DEFAULT_SETTINGS, LIMITS } from "@shared/settings";
  import { settings } from "../lib/settings.svelte";

  /** Which side of the window the sidebar is on: the handle sits on its inner edge. */
  let { side }: { side: "left" | "right" } = $props();

  const KEY_STEP = 8;
  let drag: { pointerX: number; width: number } | null = null;
  let width = $state(0);
  let dragging = $state(false);

  const clamp = (value: number) => Math.round(Math.min(LIMITS.sidebarWidth.max, Math.max(LIMITS.sidebarWidth.min, value)));

  // While dragging, only the CSS variable moves (no IPC per pixel); the value is saved on release.
  function preview(value: number): void {
    width = clamp(value);
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
  }

  function commit(value: number): void {
    settings.update({ layout: { sidebarWidth: clamp(value) } });
  }

  function onPointerDown(event: PointerEvent & { currentTarget: HTMLElement }): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag = { pointerX: event.clientX, width: settings.current.layout.sidebarWidth };
    width = drag.width;
    dragging = true;
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag) return;
    const delta = event.clientX - drag.pointerX;
    preview(drag.width + (side === "left" ? delta : -delta));
  }

  function onPointerUp(): void {
    if (!drag) return;
    drag = null;
    dragging = false;
    commit(width);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const grow = (event.key === "ArrowRight") === (side === "left");
    commit(settings.current.layout.sidebarWidth + (grow ? KEY_STEP : -KEY_STEP));
  }
</script>

<!-- A focusable separator is the standard pattern for a resizable splitter (arrow keys resize it). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="resizer {side}"
  class:dragging
  role="separator"
  aria-orientation="vertical"
  aria-label="Largeur de la barre latérale"
  aria-valuemin={LIMITS.sidebarWidth.min}
  aria-valuemax={LIMITS.sidebarWidth.max}
  aria-valuenow={settings.current.layout.sidebarWidth}
  tabindex="0"
  title="Glisser pour redimensionner · double-clic pour la largeur par défaut"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  ondblclick={() => commit(DEFAULT_SETTINGS.layout.sidebarWidth)}
  onkeydown={onKeydown}
></div>

<style>
  .resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 1;
    width: 8px;
    cursor: col-resize;
  }
  .resizer.left {
    right: -4px;
  }
  .resizer.right {
    left: -4px;
  }
  .resizer::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 3px;
    width: 2px;
    height: 36px;
    border-radius: 2px;
    background: var(--accent);
    opacity: 0;
    transform: translateY(-50%);
    transition: opacity 0.15s var(--ease);
  }
  .resizer:hover::after,
  .resizer:focus-visible::after,
  .resizer.dragging::after {
    opacity: 0.8;
  }
  .resizer:focus-visible {
    outline: none;
  }
</style>
