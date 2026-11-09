<script lang="ts">
  import { t as tr, t } from "@shared/i18n";
  import {
    DEFAULT_PRINT_OPTIONS,
    PDF_DESTINATION,
    parsePageRanges,
    type PrintMargins,
    type PrintOptions,
    type PrintOrientation,
    type PrintPreviewInfo,
    type PrintPrinter,
  } from "@shared/print";
  import { api } from "../lib/browser.svelte";
  import Button from "../components/ui/Button.svelte";
  import Checkbox from "../components/ui/Checkbox.svelte";
  import Segmented from "../components/ui/Segmented.svelte";

  /**
   * Print preview (ADR-042): the dialog's frame and options; the PDF itself is a native view main
   * places over the left part (`info.layout.preview`). Every option change renders it again.
   */
  let { info, onClose }: { info: PrintPreviewInfo; onClose: (restoreFocus: boolean) => void } = $props();

  let options = $state<PrintOptions>({ ...DEFAULT_PRINT_OPTIONS });
  let pagesMode = $state<"all" | "custom">("all");
  let pagesText = $state("");
  let printers = $state<PrintPrinter[]>([]);
  let message = $state("");
  let busy = $state(false);

  const pagesValid = $derived(pagesMode === "all" || (pagesText.trim() !== "" && parsePageRanges(pagesText) !== null));
  const isPdf = $derived(options.destination === PDF_DESTINATION);

  $effect(() => {
    void api.print.printers().then((list) => (printers = list), () => {});
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Renders the preview again (debounced: typing page ranges). */
  function changed(patch: Partial<PrintOptions>): void {
    options = { ...options, ...patch };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!pagesValid) return;
      void api.print.update($state.snapshot(options)).then((result) => (message = result.ok ? "" : result.message), () => {});
    }, 250);
  }

  function setPages(mode: "all" | "custom", text = pagesText): void {
    pagesMode = mode;
    pagesText = text;
    const valid = mode === "all" || parsePageRanges(text) !== null;
    if (valid) changed({ pages: mode === "all" ? "" : text });
  }

  async function run(): Promise<void> {
    busy = true;
    message = "";
    const result = await api.print.run($state.snapshot(options)).catch(() => ({ ok: false as const, message: t("printPreviewPanel.operationFailed") }));
    busy = false;
    if (result.ok) onClose(false);
    else message = result.message;
  }

  function cancel(): void {
    api.print.close();
    onClose(true);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  const card = $derived(info.layout.card);
  const panel = $derived(info.layout.panel);
</script>

<svelte:window onkeydown={onKeydown} />

<div class="scrim" aria-hidden="true" onclick={cancel}></div>
<div
  class="card"
  role="dialog"
  aria-label={t("printPreviewPanel.print")}
  data-testid="print-preview"
  style:left="{card.x}px"
  style:top="{card.y}px"
  style:width="{card.width}px"
  style:height="{card.height}px"
>
  <div class="panel" style:width="{panel.width}px">
    <h2>{t("printPreviewPanel.print")}</h2>
    <p class="title" title={info.title}>{info.title}</p>

    <label class="field">
      <span>{t("printPreviewPanel.destination")}</span>
      <select class="ui-field" value={options.destination} onchange={(event) => changed({ destination: event.currentTarget.value })}>
        <option value={PDF_DESTINATION}>{t("printPreviewPanel.savePdf")}</option>
        {#each printers as printer (printer.name)}
          <option value={printer.name}>{printer.displayName}</option>
        {/each}
      </select>
    </label>

    <div class="field">
      <span>{t("printPreviewPanel.pages")}</span>
      <Segmented
        label={t("printPreviewPanel.pages")}
        value={pagesMode}
        options={[
          { value: "all" as const, label: t("printPreviewPanel.all") },
          { value: "custom" as const, label: t("printPreviewPanel.custom") },
        ]}
        onchange={(mode) => setPages(mode)}
      />
      {#if pagesMode === "custom"}
        <input
          class="ui-field"
          aria-label={t("printPreviewPanel.pagesPrint")}
          aria-invalid={!pagesValid}
          placeholder={t("printPreviewPanel.example158")}
          value={pagesText}
          oninput={(event) => setPages("custom", event.currentTarget.value)}
        />
      {/if}
    </div>

    <div class="field">
      <span>{t("printPreviewPanel.orientation")}</span>
      <Segmented
        label={t("printPreviewPanel.orientation")}
        value={options.orientation}
        options={[
          { value: "portrait" as PrintOrientation, label: t("printPreviewPanel.portrait") },
          { value: "landscape" as PrintOrientation, label: t("printPreviewPanel.landscape") },
        ]}
        onchange={(orientation) => changed({ orientation })}
      />
    </div>

    <label class="field">
      <span>{t("printPreviewPanel.margins")}</span>
      <select class="ui-field" value={options.margins} onchange={(event) => changed({ margins: event.currentTarget.value as PrintMargins })}>
        <option value="default">{t("printPreviewPanel.default")}</option>
        <option value="minimum">{t("printPreviewPanel.minimum")}</option>
        <option value="none">{t("printPreviewPanel.none")}</option>
      </select>
    </label>

    <label class="field">
      <span>{t("printPreviewPanel.scale")}</span>
      <input
        class="ui-field"
        type="number"
        min="10"
        max="200"
        step="10"
        value={options.scale}
        onchange={(event) => changed({ scale: Math.min(200, Math.max(10, Math.round(Number(event.currentTarget.value) || 100))) })}
      />
    </label>

    {#if !isPdf}
      <label class="field">
        <span>{t("printPreviewPanel.copies")}</span>
        <input
          class="ui-field"
          type="number"
          min="1"
          max="99"
          value={options.copies}
          onchange={(event) => changed({ copies: Math.min(99, Math.max(1, Math.round(Number(event.currentTarget.value) || 1))) })}
        />
      </label>
    {/if}

    <Checkbox checked={options.background} onchange={(background) => changed({ background })}>{t("printPreviewPanel.backgroundGraphics")}</Checkbox>

    {#if message}<p class="message" role="alert">{message}</p>{/if}

    <div class="buttons">
      <Button variant="quiet" onclick={cancel}>{t("printPreviewPanel.cancel")}</Button>
      <Button variant="primary" disabled={busy || !pagesValid} onclick={run}>{isPdf ? t("printPreviewPanel.save") : tr("printPreviewPanel.print2")}</Button>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.45);
  }
  .card {
    position: fixed;
    display: flex;
    justify-content: flex-end;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow: 0 20px 60px -20px rgb(0 0 0 / 0.6);
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    box-sizing: border-box;
    height: 100%;
    padding: var(--space-4);
    overflow-y: auto;
    border-left: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .title {
    margin: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .message {
    margin: 0;
    color: var(--danger-text);
    font-size: var(--text-xs);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: auto;
  }
</style>
