<script lang="ts">
  import { ratioAt, splitLayout, type SplitDivider } from "@shared/split";
  import type { SplitState, TabState } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import { internalPageOf } from "@shared/internal";
  import HttpsOnlyPage from "../HttpsOnlyPage.svelte";
  import InternalPage from "../InternalPage.svelte";
  import LoadErrorPage from "../LoadErrorPage.svelte";
  import StartPage from "../StartPage.svelte";

  /**
   * Chrome side of split view. The pages are native views laid out by main with the same
   * `splitLayout` math; this component fills the gaps between them: divider handles, the focus
   * outline of the active pane, and the start page / interstitial of panes without a page view.
   */
  let { tabs, split }: { tabs: TabState[]; split: SplitState } = $props();

  let width = $state(0);
  let height = $state(0);
  /** Ratios while dragging (applied locally right away, sent to main once per frame). */
  let dragged = $state<{ x: number; y: number } | null>(null);
  let frame = 0;

  const ratioX = $derived(dragged?.x ?? split.ratioX);
  const ratioY = $derived(dragged?.y ?? split.ratioY);
  const layout = $derived(splitLayout({ x: 0, y: 0, width, height }, tabs.length, ratioX, ratioY));

  function startDrag(event: PointerEvent, divider: SplitDivider): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const area = handle.parentElement!.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    dragged = { x: ratioX, y: ratioY };

    const move = (moveEvent: PointerEvent) => {
      if (!dragged) return;
      if (divider.axis === "x") dragged.x = ratioAt(moveEvent.clientX, area.left, area.width);
      else dragged.y = ratioAt(moveEvent.clientY, area.top, area.height);
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (dragged) api.split.setRatios(dragged.x, dragged.y);
        });
      }
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      cancelAnimationFrame(frame);
      frame = 0;
      if (dragged) api.split.setRatios(dragged.x, dragged.y);
      dragged = null;
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  /** Keyboard resizing for the divider handles. */
  function onDividerKey(event: KeyboardEvent, divider: SplitDivider): void {
    const step = { ArrowLeft: -0.05, ArrowUp: -0.05, ArrowRight: 0.05, ArrowDown: 0.05 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    if (divider.axis === "x") api.split.setRatios(ratioX + step, ratioY);
    else api.split.setRatios(ratioX, ratioY + step);
  }

  const place = (rect: { x: number; y: number; width: number; height: number }) =>
    `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
</script>

<div class="split" class:dragging={dragged} bind:clientWidth={width} bind:clientHeight={height}>
  {#each tabs as tab, index (tab.id)}
    {@const rect = layout.panes[index]}
    {@const page = internalPageOf(tab.url)}
    {#if rect}
      <!-- Pane backdrop: the page view covers it; clicks on chrome-drawn panes focus them. -->
      <div
        class="pane"
        class:focused={tab.id === browser.state.activeTabId}
        style={place(rect)}
        role="presentation"
        data-tab-id={tab.id}
        onpointerdown={() => tab.id !== browser.state.activeTabId && api.tabs.activate(tab.id)}
      >
        {#if !tab.url}<StartPage />{:else if page}<InternalPage {page} />{:else if tab.interstitial}<HttpsOnlyPage {tab} />{:else if tab.loadError}<LoadErrorPage {tab} error={tab.loadError} />{/if}
      </div>
    {/if}
  {/each}
  {#each layout.dividers as divider (divider.axis)}
    <!-- A focusable separator is an interactive ARIA widget (resizable with the arrow keys). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="divider {divider.axis}"
      style={place(divider.rect)}
      role="separator"
      tabindex="0"
      aria-orientation={divider.axis === "x" ? "vertical" : "horizontal"}
      aria-label="Redimensionner la vue scindée"
      aria-valuenow={Math.round((divider.axis === "x" ? ratioX : ratioY) * 100)}
      onpointerdown={(event) => startDrag(event, divider)}
      onkeydown={(event) => onDividerKey(event, divider)}
    >
      <span class="grip"></span>
    </div>
  {/each}
</div>

<style>
  .split {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .pane {
    position: absolute;
    overflow: hidden;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 10px 30px -12px rgb(0 0 0 / 0.5);
    transition: box-shadow 0.15s var(--ease);
  }
  /* Drawn in the gap around the native page view, which covers the pane itself. */
  .pane.focused {
    box-shadow:
      0 0 0 2px var(--accent-text),
      0 0 0 5px color-mix(in oklab, var(--accent) 22%, transparent),
      0 10px 30px -12px rgb(0 0 0 / 0.5);
  }
  .divider {
    position: absolute;
    display: grid;
    place-items: center;
    z-index: 1;
    border-radius: 4px;
  }
  .divider.x {
    cursor: col-resize;
  }
  .divider.y {
    cursor: row-resize;
  }
  .grip {
    border-radius: 2px;
    background: var(--text-faint);
    opacity: 0;
    transition: opacity 0.15s var(--ease);
  }
  .x .grip {
    width: 3px;
    height: 36px;
  }
  .y .grip {
    width: 36px;
    height: 3px;
  }
  .divider:hover .grip,
  .divider:focus-visible .grip,
  .dragging .grip {
    opacity: 1;
  }
  .dragging .divider .grip {
    background: var(--accent);
  }
  .divider:focus-visible {
    outline: none;
  }
</style>
