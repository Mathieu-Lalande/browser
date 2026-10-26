<script lang="ts" generics="T extends string">
  import Icon, { type IconName } from "../Icon.svelte";

  /** A single choice among a few options (radio group drawn as a segmented control). */
  let {
    value,
    options,
    label,
    onchange,
  }: { value: T; options: { value: T; label: string; icon?: IconName }[]; label: string; onchange: (value: T) => void } = $props();

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + (event.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
    onchange(next.value);
    queueMicrotask(() => (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[aria-checked=true]")?.focus());
  }
</script>

<div class="segmented" role="radiogroup" aria-label={label} tabindex="-1" onkeydown={onKeydown}>
  {#each options as option (option.value)}
    <button
      role="radio"
      aria-checked={option.value === value}
      tabindex={option.value === value ? 0 : -1}
      class:selected={option.value === value}
      onclick={() => onchange(option.value)}
    >
      {#if option.icon}<Icon name={option.icon} size={14} />{/if}
      {option.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: calc(var(--radius) - 1px);
    background: var(--surface-active);
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 12px;
    border-radius: calc(var(--radius) - 3px);
    color: var(--text-muted);
    font-size: 12.5px;
    white-space: nowrap;
    transition:
      background 0.15s var(--ease),
      color 0.15s var(--ease);
  }
  button:hover:not(.selected) {
    color: var(--text);
  }
  button.selected {
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.15),
      inset 0 0 0 1px var(--border);
  }
</style>
