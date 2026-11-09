<script lang="ts">
  import { t } from "@shared/i18n";
  import { OmniboxController, dispositionOf } from "./controller.svelte";
  import BarInput from "./BarInput.svelte";
  import BarFooter from "./BarFooter.svelte";
  import ConfirmPanel from "./ConfirmPanel.svelte";
  import ResultList from "./ResultList.svelte";
  import ScopeChips from "./ScopeChips.svelte";

  /**
   * The universal bar (ADR-032), in the overlay layer: one input for tabs of every space, pages,
   * commands, settings and instant answers. Keyboard-first; the mouse works the same.
   */
  let { onClose }: { onClose: (restoreFocus: boolean) => void } = $props();

  // svelte-ignore state_referenced_locally
  const bar = new OmniboxController(onClose);
  let input = $state<HTMLInputElement>();

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (bar.confirming) {
        bar.cancelConfirm();
        queueMicrotask(() => input?.focus());
      } else {
        bar.close();
      }
      return;
    }
    if (bar.confirming || event.isComposing) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        bar.move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        bar.move(-1);
        break;
      case "Tab":
        event.preventDefault();
        if (!event.shiftKey) bar.complete();
        break;
      case "Enter":
        event.preventDefault();
        bar.perform(bar.selection, dispositionOf(event));
        break;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="panel" role="dialog" aria-modal="true" aria-label={t("universalBar.universalBar")}>
  {#if bar.confirming}
    <ConfirmPanel
      command={bar.confirming}
      onConfirm={() => bar.confirm()}
      onCancel={() => {
        bar.cancelConfirm();
        queueMicrotask(() => input?.focus());
      }}
    />
  {:else}
    <BarInput {bar} bind:input />
    {#if !bar.scope && bar.input === ""}
      <ScopeChips onPick={(scope) => bar.setScope(scope)} />
    {/if}
    <ResultList {bar} />
    <BarFooter />
  {/if}
</div>

<style>
  .panel {
    position: absolute;
    top: max(48px, 13vh);
    left: 50%;
    display: flex;
    flex-direction: column;
    width: min(680px, calc(100vw - 32px));
    max-height: min(580px, calc(100vh - max(48px, 13vh) - 24px));
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 18px;
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.18),
      0 2px 6px rgb(0 0 0 / 0.12),
      0 28px 64px -18px rgb(0 0 0 / 0.5);
    transform: translateX(-50%);
    /* The only motion: the opening. Results never fade in (they must feel instant). */
    animation: pop var(--motion-fast) var(--ease);
  }
  @media (prefers-color-scheme: light) {
    .panel {
      box-shadow:
        0 0 0 1px rgb(20 10 40 / 0.06),
        0 2px 6px rgb(20 10 40 / 0.06),
        0 28px 64px -18px rgb(20 10 40 / 0.32);
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-4px) scale(0.985);
    }
  }
  @media (max-width: 520px) {
    .panel {
      top: 12px;
      max-height: calc(100vh - 24px);
      border-radius: 14px;
    }
  }
</style>
