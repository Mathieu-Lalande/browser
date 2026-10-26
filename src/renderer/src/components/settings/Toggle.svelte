<script lang="ts">
  let { checked, label, onchange }: { checked: boolean; label: string; onchange: (checked: boolean) => void } = $props();
</script>

<button class="toggle" class:on={checked} role="switch" aria-checked={checked} aria-label={label} onclick={() => onchange(!checked)}>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    position: relative;
    flex: none;
    width: 38px;
    height: 22px;
    padding: 0;
    border-radius: 11px;
    background: var(--surface-active);
    box-shadow: inset 0 0 0 1px var(--border);
    transition: background 0.18s var(--ease);
  }
  .toggle.on {
    background: var(--accent);
    box-shadow: none;
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
    transition:
      transform 0.18s var(--ease),
      background 0.18s var(--ease);
  }
  .on .knob {
    transform: translateX(16px);
  }
</style>
