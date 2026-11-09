<script lang="ts" generics="T extends string">
  import type { IconName } from "./Icon.svelte";
  import Icon from "./Icon.svelte";

  /**
   * The sidebar's mode as three icon buttons in one pill (window bar, ADR-045): a radio group whose
   * current choice sits on a sliding indicator. Labels live in the accessible names and tooltips.
   */
  type Option<T> = { value: T; label: string; title: string; icon: IconName };
  let {
    value,
    options,
    label,
    onchange,
  }: { value: T | null; options: Option<T>[]; label: string; onchange: (value: T) => void } = $props();

  const index = $derived(options.findIndex((option) => option.value === value));

  /** Arrow keys move the choice, like any radio group. */
  function onKey(event: KeyboardEvent): void {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = options[(Math.max(index, 0) + step + options.length) % options.length];
    onchange(next.value);
    (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  }
</script>

<div class="switch" role="radiogroup" aria-label={label} tabindex="-1" onkeydown={onKey} style:--count={options.length}>
  {#if index >= 0}<span class="indicator" style:--index={index} aria-hidden="true"></span>{/if}
  {#each options as option, i (option.value)}
    <button
      type="button"
      role="radio"
      data-value={option.value}
      aria-checked={i === index}
      aria-label={option.label}
      title={option.title}
      tabindex={i === Math.max(index, 0) ? 0 : -1}
      class:on={i === index}
      onclick={() => onchange(option.value)}
    >
      <Icon name={option.icon} size={16} />
    </button>
  {/each}
</div>

<style>
  .switch {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--count), var(--hit-min));
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .switch:focus {
    outline: none;
  }
  .indicator {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: var(--hit-min);
    border-radius: var(--radius-sm);
    background: var(--surface-active);
    box-shadow: var(--elevation);
    transform: translateX(calc(var(--index) * 100%));
    transition: transform var(--motion-fast) var(--ease);
  }
  button {
    position: relative;
    display: grid;
    place-items: center;
    height: calc(var(--hit-min) - 2px);
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    transition: color var(--motion-fast) var(--ease);
  }
  button:hover {
    color: var(--text);
  }
  button.on {
    color: var(--accent-text);
  }
  button:focus-visible {
    outline-offset: -2px;
  }
</style>
