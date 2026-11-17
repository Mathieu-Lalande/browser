<script lang="ts">
  let {
    value,
    min,
    max,
    step = 1,
    unit = "px",
    label,
    onchange,
  }: { value: number; min: number; max: number; step?: number; unit?: string; label: string; onchange: (value: number) => void } =
    $props();

  const percent = $derived(((value - min) / (max - min)) * 100);
</script>

<div class="slider">
  <input
    type="range"
    {min}
    {max}
    {step}
    {value}
    aria-label={label}
    style:--fill="{percent}%"
    oninput={(event) => onchange(Number(event.currentTarget.value))}
  />
  <output>{value}&#8239;{unit}</output>
</div>

<style>
  .slider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  input {
    width: 180px;
    height: 18px;
    margin: 0;
    background: transparent;
    appearance: none;
  }
  input::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--fill), var(--surface-active) var(--fill));
  }
  input::-webkit-slider-thumb {
    width: 16px;
    height: 16px;
    margin-top: calc(-1 * var(--space-1));
    border: 0;
    border-radius: 50%;
    background: #fff;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 0.08),
      0 1px 4px rgb(0 0 0 / 0.35);
    appearance: none;
    transition: transform var(--motion-fast) var(--ease);
  }
  input:active::-webkit-slider-thumb {
    transform: scale(1.15);
  }
  input:focus-visible {
    outline: none;
  }
  input:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) min(calc(45% * var(--tint, 1)), 90%), transparent);
  }
  output {
    min-width: 52px;
    padding: var(--space-1) 0;
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
</style>
