<script lang="ts">
  import { shortcutText } from "@shared/commands";
  import { MAX_SPACES } from "@shared/spaces";
  import type { SpaceId } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import { platform } from "../../lib/platform.svelte";
  import Icon from "../Icon.svelte";

  /**
   * `onEdit`: open the editor of a space (right-click, or right after creating one). `progress`:
   * share of the way to the next (+1) or previous (-1) space during a swipe; the active indicator
   * slides along, 1:1 while `following` the fingers, eased otherwise.
   */
  let { onEdit, progress = 0, following = false }: { onEdit: (id: SpaceId) => void; progress?: number; following?: boolean } = $props();

  let list = $state<HTMLElement>();
  /** Which ends of the strip hide chips (faded with a mask). */
  let fadeStart = $state(false);
  let fadeEnd = $state(false);

  /** More than 3 spaces: smaller chips, so more of them fit beside the footer buttons. */
  const compact = $derived(browser.state.spaces.length > 3);

  async function create(): Promise<void> {
    const space = await api.spaces.create().catch(() => null);
    if (space) onEdit(space.id);
  }

  function measure(): void {
    if (!list) return;
    fadeStart = list.scrollLeft > 1;
    fadeEnd = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
  }

  // The active space's chip is always in view (switched by shortcut or from another window).
  $effect(() => {
    const id = browser.state.activeSpaceId;
    void browser.state.spaces.length;
    queueMicrotask(() => {
      list?.querySelector<HTMLElement>(`[data-space-id="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      measure();
    });
  });

  $effect(() => {
    if (!list) return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  });

  /** The active indicator, between the active chip and the one the swipe goes to. */
  let indicator = $state<{ left: number; color: string } | null>(null);
  $effect(() => {
    const index = browser.state.spaces.findIndex((space) => space.id === browser.state.activeSpaceId);
    const chips = list ? [...list.querySelectorAll<HTMLElement>("[data-space-id]")] : [];
    void compact;
    const from = chips[index];
    if (!from) {
      indicator = null;
      return;
    }
    const to = chips[index + Math.sign(progress)] ?? from;
    const center = (chip: HTMLElement) => chip.offsetLeft + chip.offsetWidth / 2;
    const left = center(from) + (center(to) - center(from)) * Math.abs(progress);
    const space = browser.state.spaces[index];
    indicator = { left, color: space.color ?? "var(--accent)" };
  });

  /** Vertical wheel scrolls the strip sideways. */
  function onWheel(event: WheelEvent): void {
    if (!list || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    list.scrollLeft += event.deltaY;
    event.preventDefault();
  }
</script>

<div class="switcher" class:compact>
  <div
    class="spaces"
    class:fade-start={fadeStart}
    class:fade-end={fadeEnd}
    role="tablist"
    aria-label="Espaces"
    bind:this={list}
    onscroll={measure}
    onwheel={onWheel}
  >
    {#each browser.state.spaces as space, index (space.id)}
      {@const active = space.id === browser.state.activeSpaceId}
      <button
        class="space"
        class:active
        role="tab"
        aria-selected={active}
        aria-label={space.name}
        data-icon={space.icon}
        data-space-id={space.id}
        title={index < 9 ? `${space.name} (${shortcutText(`CmdOrCtrl+Alt+${index + 1}`, platform.name)})` : space.name}
        style:--dot={space.color ?? "var(--accent)"}
        onclick={() => (active ? onEdit(space.id) : api.spaces.switchTo(space.id))}
        oncontextmenu={(event) => (event.preventDefault(), onEdit(space.id))}
      >
        <Icon name={space.icon} size={compact ? 14 : 16} />
      </button>
    {/each}
    {#if indicator}
      <span class="indicator" class:following style:left="{indicator.left}px" style:--dot={indicator.color} aria-hidden="true"></span>
    {/if}
  </div>
  <button
    class="add"
    aria-label="Nouvel espace"
    title={browser.state.spaces.length >= MAX_SPACES ? `Nouvel espace (${MAX_SPACES} au maximum)` : "Nouvel espace"}
    disabled={browser.state.spaces.length >= MAX_SPACES}
    onclick={create}
  >
    <Icon name="layers-plus" size={16} />
  </button>
</div>

<style>
  .switcher {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .spaces {
    position: relative;
    display: flex;
    gap: 2px;
    min-width: 0;
    padding: 2px;
    overflow-x: auto;
    scrollbar-width: none;
    scroll-padding-inline: 12px;
  }
  /* Chips cut by the strip's edges fade out: there is more to scroll to. */
  .spaces.fade-start {
    mask-image: linear-gradient(to right, transparent, #000 18px);
  }
  .spaces.fade-end {
    mask-image: linear-gradient(to left, transparent, #000 18px);
  }
  .spaces.fade-start.fade-end {
    mask-image: linear-gradient(to right, transparent, #000 18px, #000 calc(100% - 18px), transparent);
  }
  .space,
  .add {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: var(--text-muted);
    transition:
      background 0.12s var(--ease),
      color 0.12s var(--ease),
      transform 0.12s var(--ease);
  }
  .compact .space {
    width: 24px;
  }
  .space:focus-visible,
  .add:focus-visible {
    outline-offset: -2px;
  }
  .space:hover,
  .add:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }
  .space:active {
    transform: scale(0.92);
  }
  .space.active {
    background: color-mix(in oklab, var(--dot) 18%, transparent);
    color: color-mix(in oklab, var(--dot) 70%, var(--text));
  }
  /* One bar for the strip: it slides from chip to chip (with the fingers during a swipe). */
  .indicator {
    position: absolute;
    bottom: 3px;
    width: 12px;
    height: 2px;
    border-radius: 2px;
    background: var(--dot);
    transform: translateX(-50%);
    transition:
      left 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
      background 0.22s var(--ease);
    pointer-events: none;
  }
  .indicator.following {
    transition: none;
  }
  .add:disabled {
    opacity: 0.35;
  }
</style>
