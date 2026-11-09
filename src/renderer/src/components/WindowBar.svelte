<script lang="ts" module>
  /** How the sidebar shows: full, compact rail, zen (hidden, back from the edge), or hidden for now (Ctrl+S). */
  export type SidebarMode = "full" | "compact" | "zen" | "hidden";
</script>

<script lang="ts">
  import { energyTooltip } from "@shared/energy";
  import { api, browser } from "../lib/browser.svelte";
  import Icon from "./Icon.svelte";
  import { platform } from "../lib/platform.svelte";
  import SidebarModeSwitch from "./SidebarModeSwitch.svelte";
  import WindowControls from "./WindowControls.svelte";

  /**
   * The window bar (ADR-045), above the sidebar and the page: folded to a thin strip at rest, it
   * unfolds while the pointer rests at the very top of the window. The sidebar's mode at its start
   * (one icon choice among Complète, Compacte and Zen, named in tooltips and accessible names; clicking the current Compacte or Zen again
   * goes back to Complète), window controls at its end (Windows/Linux;
   * macOS shows its traffic lights with it), a drag area between them. The strip is never a drag
   * region: those swallow mouse events. `mode` "hidden": hidden for now (Ctrl+S), none is current.
   */
  let { mode, onMode }: { mode: SidebarMode; onMode: (mode: Exclude<SidebarMode, "hidden">) => void } = $props();

  type Mode = Exclude<SidebarMode, "hidden">;

  /** Energy saver on (ADR-048): a battery (on battery) or a sprout (always) after the modes. */
  const energy = $derived(browser.state.energy);
  const energyTip = $derived(energy ? energyTooltip(energy) : null);
  const modes = $derived<{ value: Mode; label: string; title: string; icon: "sidebar" | "sidebar-compact" | "zen" }[]>([
    { value: "full", label: "Complète", icon: "sidebar", title: "Barre latérale complète : onglets, adresse, espaces" },
    {
      value: "compact",
      label: "Compacte",
      icon: "sidebar-compact",
      title: platform.tip("Barre latérale compacte : les icônes des onglets, dépliée au survol. Recliquer : barre complète", "toggle-compact-mode"),
    },
    {
      value: "zen",
      label: "Zen",
      icon: "zen",
      title: platform.tip("Mode zen : barre masquée, elle revient quand la souris touche le bord. Recliquer : barre complète", "toggle-zen"),
    },
  ]);

  /** A choice, never a no-op: the current Compacte or Zen clicked again goes back to Complète. */
  function choose(next: Mode): void {
    onMode(next === mode && next !== "full" ? "full" : next);
  }

  /** Unfolded height (the macOS traffic lights are centered in it, see WindowChrome). */
  const HEIGHT = 40;
  /** The pointer must rest on the strip a moment: crossing it on the way out of the window does nothing. */
  const REVEAL_DELAY = 90;
  const HIDE_DELAY = 300;

  let revealed = $state(false);
  let bar = $state<HTMLElement>();
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function reveal(): void {
    clearTimeout(hideTimer);
    if (revealed) return;
    revealed = true;
    api.window.watchTopBar(HEIGHT);
  }

  function fold(): void {
    clearTimeout(hideTimer);
    revealed = false;
    api.window.watchTopBar(0);
  }

  /** The pointer left the bar: fold it shortly after, unless the keyboard is in it (not a mere click). */
  function leave(): void {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!bar?.querySelector(":focus-visible")) fold();
    }, HIDE_DELAY);
  }

  function onEnter(): void {
    clearTimeout(hideTimer);
    if (revealed) return;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(reveal, REVEAL_DELAY);
  }

  /** Below the bar (the sidebar, the page's card): it folds. Above or into its drag area: main watches. */
  function onLeave(event: MouseEvent): void {
    clearTimeout(revealTimer);
    if (revealed && bar && event.clientY >= bar.getBoundingClientRect().bottom) leave();
  }

  function onFocusOut(event: FocusEvent): void {
    if (revealed && !bar?.contains(event.relatedTarget as Node | null) && !bar?.matches(":hover")) leave();
  }

  // Main saw the pointer leave the band (over the page view, a drag region, out of the window).
  $effect(() => api.window.onTopBarLeft(leave));

  // While unfolded, any pointer move in the UI below it folds it (a fast move skips the mouseleave).
  $effect(() => {
    if (!revealed) return;
    const onMove = (event: MouseEvent) => {
      if (event.clientY > HEIGHT + 4) leave();
      else clearTimeout(hideTimer);
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  });

  $effect(() => () => {
    clearTimeout(revealTimer);
    clearTimeout(hideTimer);
    if (revealed) api.window.watchTopBar(0);
  });
</script>

<div
  bind:this={bar}
  class="window-bar"
  class:revealed
  class:mac={platform.isMac}
  role="presentation"
  data-testid="window-bar"
  onmouseenter={onEnter}
  onmouseleave={onLeave}
  onfocusout={onFocusOut}
>
  {#if revealed}
    <div class="start">
      <SidebarModeSwitch value={mode === "hidden" ? null : mode} options={modes} label="Barre latérale" onchange={choose} />
      {#if energy && energyTip}
        <span class="energy" role="img" aria-label={energyTip} title={energyTip} data-testid="energy-indicator">
          <Icon name={energy.reason === "battery" ? "energy-battery" : "energy-always"} />
        </span>
      {/if}
    </div>
    <span class="drag-area drag"></span>
    {#if !platform.isMac}<WindowControls />{/if}
  {/if}
</div>

<style>
  /* Folded: the top gutter of the window, uncovered by the page view so the UI sees the pointer. */
  .window-bar {
    position: relative;
    z-index: 5;
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    height: max(var(--gutter), 8px);
    padding: 0 4px;
    overflow: hidden;
    transition: height var(--motion-fast) var(--ease);
  }
  .window-bar.revealed {
    height: 40px;
  }
  /* macOS: room for the traffic lights (16px from the left edge, about 52px wide). */
  .window-bar.mac {
    padding-left: 76px;
  }
  .start {
    display: flex;
    align-items: center;
    animation: appear var(--motion-fast) var(--ease);
  }
  .energy {
    display: grid;
    place-items: center;
    width: var(--hit-min);
    height: var(--hit-min);
    margin-left: var(--space-1);
    color: var(--accent-text);
  }
  .drag-area {
    flex: 1;
    align-self: stretch;
  }
  .window-bar :global(.controls) {
    animation: appear var(--motion-fast) var(--ease);
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
  }
</style>
