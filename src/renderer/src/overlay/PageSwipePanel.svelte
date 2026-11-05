<script lang="ts">
  import type { Bounds, PageSwipeIndicator } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import Icon from "../components/Icon.svelte";

  /**
   * Back/forward indicator of a two-finger swipe on the page (ADR-033): an arrow that slides in
   * from the page's edge with the fingers and fills up at the threshold. The overlay covers the
   * page meanwhile, so the rest of the gesture's wheel events land here: they go back to main,
   * which runs the gesture (src/main/page-swipe.ts).
   */
  let { anchor, initial }: { anchor?: Bounds; initial: PageSwipeIndicator } = $props();

  // svelte-ignore state_referenced_locally
  let indicator = $state<PageSwipeIndicator>(initial);

  $effect(() => api.overlay.onPageSwipe((next) => (indicator = next)));

  $effect(() => {
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      api.overlay.swipeWheel({ deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  });

  const SIZE = 44;
  const area = $derived(anchor ?? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
  /** The arrow comes in from its edge, at most its own width plus a margin. */
  const shift = $derived(Math.min(1, indicator.progress) * (SIZE + 16));
  const left = $derived(indicator.direction < 0 ? area.x - SIZE + shift : area.x + area.width - shift);
</script>

<div
  class="swipe"
  class:ready={indicator.ready}
  class:committed={indicator.committed}
  data-testid="page-swipe"
  data-direction={indicator.direction < 0 ? "back" : "forward"}
  role="status"
  aria-label={indicator.direction < 0 ? "Page précédente" : "Page suivante"}
  style:left="{left}px"
  style:top="{area.y + area.height / 2 - SIZE / 2}px"
  style:--progress={indicator.progress}
>
  <Icon name={indicator.direction < 0 ? "back" : "forward"} size={20} strokeWidth={2.4} />
</div>

<style>
  .swipe {
    position: fixed;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 22px;
    background: color-mix(in srgb, var(--accent) calc(var(--progress) * 100%), var(--bg-elevated));
    color: var(--text);
    box-shadow:
      0 0 0 1px var(--border),
      0 10px 30px -10px rgb(0 0 0 / 0.5);
    opacity: calc(0.4 + var(--progress) * 0.6);
    pointer-events: none;
    transition: none;
  }
  .swipe.ready {
    color: var(--on-accent);
    transform: scale(1.1);
  }
  .swipe.committed {
    opacity: 0;
  }
</style>
