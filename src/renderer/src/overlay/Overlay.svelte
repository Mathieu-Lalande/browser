<script lang="ts">
  import { isPopover, type OverlayBackdrop, type OverlayRequest } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import { settings } from "../lib/settings.svelte";
  import { applyTheme } from "../lib/theme";
  import CommandPalette from "./CommandPalette.svelte";
  import DownloadsPanel from "./DownloadsPanel.svelte";

  // Root of the overlay layer (src/main/overlay.ts): a transparent page above the tab views,
  // attached only while a floating UI is open.

  // Follow theme changes made while the overlay stays loaded.
  $effect(() => applyTheme(settings.current, settings.mode));

  /** What is shown, null when hidden. `id` remounts the UI on every open (fresh state). */
  let current = $state<{ request: OverlayRequest; id: number } | null>(null);
  let opened = 0;

  /** Blurred snapshot of the window below (arrives a few ms after opening). */
  let backdrop = $state<OverlayBackdrop | null>(null);

  $effect(() =>
    api.overlay.onShow((request) => {
      if (!current) backdrop = null;
      current = { request, id: ++opened };
    }),
  );

  $effect(() =>
    api.overlay.onBackdrop((next) => {
      if (current) backdrop = next;
    }),
  );

  // Main may detach the overlay by itself (Ctrl+K again, a shortcut that focuses the chrome UI):
  // clear it so the next open never shows a stale frame.
  $effect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        current = null;
        backdrop = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  });

  /**
   * Hides the UI and asks main to detach the view right away (not after a frame: a Ctrl+K
   * pressed meanwhile would then be undone by the late close).
   */
  function close(restoreFocus: boolean): void {
    current = null;
    backdrop = null;
    api.overlay.close(restoreFocus);
  }
</script>

{#if current}
  {#if backdrop}
    <div class="backdrop" aria-hidden="true">
      {#each backdrop.layers as layer, index (index)}
        <img
          src={layer.image}
          alt=""
          style:left="{layer.bounds.x}px"
          style:top="{layer.bounds.y}px"
          style:width="{layer.bounds.width}px"
          style:height="{layer.bounds.height}px"
        />
      {/each}
    </div>
  {/if}
  {#key current.id}
    <!-- Clicking outside the panel closes it (pointer only: Escape is the keyboard way). -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="scrim"
      class:clear={isPopover(current.request.kind)}
      onmousedown={(event) => event.target === event.currentTarget && close(true)}
    >
      {#if current.request.kind === "palette"}
        <CommandPalette onClose={close} />
      {:else if current.request.kind === "downloads"}
        <DownloadsPanel anchor={current.request.anchor} onClose={close} />
      {/if}
    </div>
  {/key}
{/if}

<style>
  /* The overlay page must not hide the page below: no body background (global.css sets one). */
  :global(html.overlay),
  :global(html.overlay body) {
    background: transparent;
  }
  .scrim {
    position: fixed;
    inset: 0;
    background: rgb(10 8 18 / 0.5);
    animation: fade 0.14s var(--ease);
  }
  /* CSS cannot blur the native views behind this page: main sends a snapshot of them instead. */
  .backdrop {
    position: fixed;
    inset: 0;
    filter: blur(20px) saturate(1.3);
    /* Blurred edges fade to transparent: overscan a little so they stay off-screen. */
    transform: scale(1.06);
    animation: fade 0.18s var(--ease);
  }
  .backdrop img {
    position: absolute;
    border-radius: var(--radius);
  }
  @media (prefers-color-scheme: light) {
    .scrim {
      background: rgb(30 20 55 / 0.22);
    }
  }
  /* Popovers: the page stays as it is around them (the layer still catches outside clicks). */
  .scrim.clear {
    background: transparent;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
