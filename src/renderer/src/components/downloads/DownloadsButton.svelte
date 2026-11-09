<script lang="ts">
  import { t } from "@shared/i18n";
  import { api } from "../../lib/browser.svelte";
  import { downloads } from "../../lib/downloads.svelte";
  import Icon from "../Icon.svelte";

  /** Sidebar footer button: a live progress ring while something downloads; opens the downloads popover. */

  const RADIUS = 11;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  let button: HTMLButtonElement;
  const running = $derived(downloads.active.length > 0);
  const progress = $derived(downloads.progress);
  const waiting = $derived(downloads.awaiting.length > 0);
  const label = $derived(
    waiting
      ? t("downloadsButton.downloadsFileWaitingConfirmation")
      : running
        ? progress === null
          ? t("downloadsButton.running", { count: downloads.active.length })
          : t("downloadsButton.runningProgress", { count: downloads.active.length, percent: Math.round(progress * 100) })
        : t("downloadsButton.downloads"),
  );

  function open(): void {
    const rect = button.getBoundingClientRect();
    api.downloads.showPanel({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
</script>

<button bind:this={button} class="downloads" class:running aria-label={label} title={label} onclick={open}>
  {#if running}
    <svg class="ring" class:indeterminate={progress === null} viewBox="0 0 26 26" aria-hidden="true">
      <circle class="track" cx="13" cy="13" r={RADIUS} />
      <circle
        class="value"
        cx="13"
        cy="13"
        r={RADIUS}
        stroke-dasharray={CIRCUMFERENCE}
        stroke-dashoffset={CIRCUMFERENCE * (1 - (progress ?? 0.25))}
      />
    </svg>
  {/if}
  <Icon name="download" size={running ? 12 : 16} />
  {#if waiting}<span class="dot" aria-hidden="true"></span>{/if}
</button>

<style>
  .downloads {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: var(--icon-button);
    height: var(--icon-button);
    border-radius: 8px;
    color: var(--text-muted);
  }
  .downloads:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .downloads.running {
    color: var(--accent-text);
  }
  .ring {
    position: absolute;
    width: 26px;
    height: 26px;
    transform: rotate(-90deg);
  }
  .ring circle {
    fill: none;
    stroke-width: 2.4;
  }
  .track {
    stroke: var(--surface-active);
  }
  .value {
    stroke: var(--accent);
    stroke-linecap: round;
    transition: stroke-dashoffset var(--motion-base) linear;
  }
  .ring.indeterminate {
    animation: spin 1s linear infinite;
  }
  .dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 8px;
    height: 8px;
    border: 2px solid var(--bg);
    border-radius: 50%;
    background: #e8a317;
  }
  @keyframes spin {
    from {
      transform: rotate(-90deg);
    }
    to {
      transform: rotate(270deg);
    }
  }
</style>
