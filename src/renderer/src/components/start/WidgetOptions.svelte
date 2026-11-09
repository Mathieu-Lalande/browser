<script lang="ts">
  import { t } from "@shared/i18n";
  import { LIMITS, SIZE_LABELS, WIDGET_CATALOG, type StartWidget, type TemperatureUnit, type WidgetSize } from "@shared/start-widgets";
  import { isNavigableUrl } from "@shared/url";
  import Button from "../ui/Button.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import type { StartLayout } from "./layout.svelte";

  /** The options popover of one widget (edit mode): its size, then what its kind offers. */
  let { widget, layout, onclose }: { widget: StartWidget; layout: StartLayout; onclose: () => void } = $props();

  const info = $derived(WIDGET_CATALOG[widget.kind]);
  const set = (patch: Record<string, unknown>) => layout.setOptions(widget.id, patch);
  const COUNTS = ["4", "8", "12"] as const;

  let pinUrl = $state("");
  let pinTitle = $state("");
  let pinError = $state(false);

  function addPin(event: SubmitEvent): void {
    event.preventDefault();
    if (widget.kind !== "top-sites") return;
    const url = /^https?:\/\//i.test(pinUrl.trim()) ? pinUrl.trim() : `https://${pinUrl.trim()}`;
    if (!isNavigableUrl(url)) {
      pinError = true;
      return;
    }
    set({ pins: [...widget.options.pins, { url, title: pinTitle.trim() }] });
    pinUrl = pinTitle = "";
    pinError = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onclose();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="options" role="dialog" aria-label={t("widgetOptions.options", { label: info.label })} tabindex="-1" onkeydown={onKeydown}>
  <header>
    <strong>{info.label}</strong>
    <IconButton icon="close" size="sm" label={t("widgetOptions.closeOptions")} onclick={onclose} />
  </header>
  {#if info.sizes.length > 1}
    <div class="field">
      <span>{t("widgetOptions.size")}</span>
      <Segmented
        label={t("widgetOptions.widgetSize")}
        value={widget.size}
        options={info.sizes.map((size) => ({ value: size as WidgetSize, label: SIZE_LABELS[size] }))}
        onchange={(size) => layout.resize(widget.id, size)}
      />
    </div>
  {/if}

  {#if widget.kind === "clock"}
    <div class="field"><span>{t("widgetOptions.greeting")}</span><Toggle label={t("widgetOptions.greeting")} checked={widget.options.greeting} onchange={(greeting) => set({ greeting })} /></div>
    <div class="field"><span>{t("widgetOptions.date")}</span><Toggle label={t("widgetOptions.date")} checked={widget.options.date} onchange={(date) => set({ date })} /></div>
  {:else if widget.kind === "top-sites" || widget.kind === "favorites" || widget.kind === "resume" || widget.kind === "devices"}
    <div class="field">
      <span>{t("widgetOptions.number")}</span>
      <Segmented
        label={t("widgetOptions.numberItems")}
        value={String(widget.options.count)}
        options={COUNTS.map((count) => ({ value: count as string, label: count }))}
        onchange={(count) => set({ count: Number(count) })}
      />
    </div>
    {#if widget.kind === "top-sites"}
      <div class="pins">
        <span>{t("widgetOptions.pinnedSites")}</span>
        {#each widget.options.pins as pin (pin.url)}
          <div class="pin">
            <span title={pin.url}>{pin.title || pin.url}</span>
            <IconButton
              icon="close"
              size="sm"
              label={t("widgetOptions.unpin", { p: pin.title || pin.url })}
              onclick={() => widget.kind === "top-sites" && set({ pins: widget.options.pins.filter((other) => other.url !== pin.url) })}
            />
          </div>
        {/each}
        {#if widget.options.pins.length < LIMITS.pins}
          <form onsubmit={addPin}>
            <input class="ui-field" class:invalid={pinError} bind:value={pinUrl} placeholder={t("widgetOptions.address")} aria-label={t("widgetOptions.addressSitePin")} spellcheck="false" />
            <input class="ui-field" bind:value={pinTitle} placeholder={t("widgetOptions.nameOptional")} aria-label={t("widgetOptions.namePinnedSite")} maxlength={LIMITS.pinTitle} />
            <Button size="sm" type="submit" icon="pin">{t("widgetOptions.pin")}</Button>
          </form>
        {/if}
      </div>
    {/if}
  {:else if widget.kind === "weather"}
    <div class="field">
      <span>{t("widgetOptions.unit")}</span>
      <Segmented
        label={t("widgetOptions.temperatureUnit")}
        value={widget.options.unit}
        options={[
          { value: "c" as TemperatureUnit, label: "°C" },
          { value: "f" as TemperatureUnit, label: "°F" },
        ]}
        onchange={(unit) => set({ unit })}
      />
    </div>
    {#if widget.options.place}
      <div class="field"><span>{widget.options.place.name}</span><Button size="sm" onclick={() => set({ place: null })}>{t("widgetOptions.changeCity")}</Button></div>
    {/if}
    <p class="note">{t("widgetOptions.openMeteoReceivesCitys")}</p>
  {:else if widget.kind === "calendar"}
    <div class="field"><span>{t("widgetOptions.weekNumbers")}</span><Toggle label={t("widgetOptions.weekNumbers")} checked={widget.options.weekNumbers} onchange={(weekNumbers) => set({ weekNumbers })} /></div>
  {:else if widget.kind === "todo"}
    <div class="field"><span>{t("widgetOptions.hideCompletedTasks")}</span><Toggle label={t("widgetOptions.hideCompletedTasks")} checked={widget.options.hideDone} onchange={(hideDone) => set({ hideDone })} /></div>
  {:else if widget.kind === "notes"}
    <p class="note">{t("widgetOptions.notesStayDeviceThey")}</p>
  {/if}
</div>

<style>
  .options {
    position: absolute;
    top: 40px;
    right: var(--space-2);
    z-index: 5;
    display: grid;
    gap: var(--space-3);
    width: 300px;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow: 0 18px 50px -12px rgb(0 0 0 / 0.45);
    color: var(--text);
    font-size: var(--text-sm);
    text-align: left;
    animation: pop var(--motion-fast) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--text-muted);
  }
  .pins {
    display: grid;
    gap: var(--space-2);
    color: var(--text-muted);
  }
  .pin {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    color: var(--text);
  }
  .pin span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  form {
    display: grid;
    gap: var(--space-2);
  }
  .note {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(calc(-1 * var(--space-1)));
    }
  }
</style>
