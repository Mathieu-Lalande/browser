<script lang="ts">
  import type { CaptureResult } from "@shared/capture";
  import { api } from "../lib/browser.svelte";
  import Icon from "../components/Icon.svelte";

  /**
   * A screenshot just taken (ADR-031): a small preview in the bottom-right corner with "Copier"
   * and "Enregistrer". The image stays in main; closing the popover forgets it.
   */
  let { capture, onClose }: { capture: CaptureResult; onClose: (restoreFocus: boolean) => void } = $props();

  let panel = $state<HTMLElement>();
  let copied = $state(false);
  let failed = $state(false);
  let saving = $state(false);

  $effect(() => panel?.focus());
  // However it closes (Escape, a click outside, an action), main forgets the image.
  $effect(() => {
    const id = capture.id;
    return () => api.capture.discard(id);
  });

  async function copy(): Promise<void> {
    failed = !(await api.capture.copy(capture.id).catch(() => false));
    copied = !failed;
  }

  async function save(): Promise<void> {
    saving = true;
    const saved = await api.capture.save(capture.id).catch(() => false);
    saving = false;
    if (saved) onClose(false);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div bind:this={panel} class="panel" role="dialog" aria-label="Capture d'écran" tabindex="-1" onkeydown={onKeydown}>
  <div class="preview"><img src={capture.preview} alt="Aperçu de la capture" /></div>
  <div class="info">
    <span class="title">Capture d'écran</span>
    <span class="size" data-testid="capture-size">{capture.width} × {capture.height}</span>
    <button class="close" aria-label="Fermer" title="Fermer" onclick={() => onClose(true)}><Icon name="close" size={14} /></button>
  </div>
  <div class="actions">
    <button onclick={copy}>
      <Icon name={copied ? "check" : "copy-text"} size={14} />
      {copied ? "Copiée" : failed ? "Échec de la copie" : "Copier"}
    </button>
    <button class="primary" onclick={save} disabled={saving}>
      <Icon name="save" size={14} />
      Enregistrer
    </button>
  </div>
</div>

<style>
  .panel {
    position: fixed;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 280px;
    padding: 8px;
    border-radius: calc(var(--radius) + 4px);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55);
    outline: none;
    animation: rise 0.18s var(--ease);
  }
  .preview {
    display: grid;
    place-items: center;
    max-height: 200px;
    overflow: hidden;
    border-radius: var(--radius);
    background: var(--surface);
  }
  .preview img {
    display: block;
    max-width: 100%;
    max-height: 200px;
    object-fit: contain;
  }
  .info {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 2px 0 4px;
  }
  .title {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
  }
  .size {
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .close {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-faint);
  }
  .close:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .actions button {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    border-radius: 7px;
    background: var(--surface);
    font-size: 12.5px;
    font-weight: 500;
  }
  .actions button:hover {
    background: var(--surface-hover);
  }
  .actions .primary {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }
  .actions .primary:hover {
    background: color-mix(in oklab, var(--accent) 88%, black);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
