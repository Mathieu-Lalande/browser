<script lang="ts" generics="S extends { name: string; color: string; gradient?: string }">
  import { normalizeHex } from "@shared/settings";
  import Icon from "../Icon.svelte";

  /** Preset swatches plus a free color (native picker + hex field). */
  let {
    value,
    swatches,
    label,
    onselect,
    onchange,
  }: { value: string; swatches: S[]; label: string; onselect: (swatch: S) => void; onchange: (hex: string) => void } = $props();

  const uid = $props.id();
  let draft = $state<string | null>(null);
  const isPreset = $derived(swatches.some((swatch) => swatch.color === value));

  function onHexInput(event: Event & { currentTarget: HTMLInputElement }): void {
    draft = event.currentTarget.value;
    const hex = normalizeHex(draft);
    if (hex && /^#?[\da-f]{6}$/i.test(draft.trim())) onchange(hex);
  }
</script>

<div class="picker">
  <div class="swatches" role="radiogroup" aria-label={label}>
    {#each swatches as swatch (swatch.name)}
      <button
        class="swatch"
        role="radio"
        aria-checked={swatch.color === value}
        aria-label={swatch.name}
        title={swatch.name}
        style:--swatch={swatch.gradient ?? swatch.color}
        onclick={() => onselect(swatch)}
      >
        {#if swatch.color === value}<Icon name="check" size={12} />{/if}
      </button>
    {/each}
    <label
      class="swatch custom"
      class:active={!isPreset}
      title="Couleur personnalisée"
      style:--swatch={isPreset ? undefined : value}
    >
      <input type="color" {value} aria-label="{label} : couleur personnalisée" oninput={(event) => onchange(event.currentTarget.value)} />
      {#if !isPreset}<Icon name="check" size={12} />{/if}
    </label>
  </div>
  <input
    id="{uid}-hex"
    class="hex"
    value={draft ?? value}
    maxlength="7"
    spellcheck="false"
    autocomplete="off"
    aria-label="{label} (hexadécimal)"
    oninput={onHexInput}
    onblur={() => (draft = null)}
  />
</div>

<style>
  .picker {
    /* Selection ring: one solid, contrast-adjusted color (the swatch itself may be a gradient). */
    --ring: var(--accent-text);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .swatch {
    position: relative;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 50%;
    background: var(--swatch);
    color: #fff;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
    transition: transform 0.12s var(--ease);
  }
  .swatch:hover {
    transform: scale(1.1);
  }
  .swatch[aria-checked="true"],
  .swatch.active {
    box-shadow:
      0 0 0 2px var(--bg-elevated),
      0 0 0 4px var(--ring);
  }
  .swatch :global(svg) {
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.5));
  }
  .custom {
    --swatch-fallback: conic-gradient(from 0deg, #ff5f57, #febc2e, #28c840, #22d3ee, #3b82f6, #8b5cf6, #ec4899, #ff5f57);
    background: var(--swatch, var(--swatch-fallback));
    overflow: hidden;
  }
  .custom input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
  }
  .hex {
    width: 84px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    outline: 0;
    background: var(--surface);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px;
    text-transform: lowercase;
    user-select: text;
  }
  .hex:focus {
    border-color: var(--accent-text);
  }
</style>
