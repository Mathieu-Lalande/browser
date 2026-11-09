<script lang="ts">
  import { LANGUAGE_SETTINGS, t, type LanguageSetting } from "@shared/i18n";
  import { ACCENT_PRESETS, LIMITS, PAGE_ZOOM_LEVELS, type BackgroundStyle, type Density, type SettingsPatch, type ThemeMode, type UiFont } from "@shared/settings";
  import { FONT_STACKS, backdrop } from "@shared/theme";
  import { platform } from "../../lib/platform.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon, { type IconName } from "../Icon.svelte";
  import Row from "../ui/Row.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import ColorPicker from "./ColorPicker.svelte";
  import MiniBrowser from "./MiniBrowser.svelte";
  import Slider from "./Slider.svelte";
  import ThemeShare from "./ThemeShare.svelte";

  /** Settings > Apparence: theme mode, colors, background, font, density, motion, default zoom. */
  const MODES: { value: ThemeMode; label: string; icon: IconName }[] = [
    { value: "system", label: t("appearanceSection.system"), icon: "monitor" },
    { value: "light", label: t("appearanceSection.light"), icon: "sun" },
    { value: "dark", label: t("appearanceSection.dark"), icon: "moon" },
  ];
  const BACKGROUNDS: { value: BackgroundStyle; label: string }[] = [
    { value: "gradient", label: t("appearanceSection.gradient") },
    { value: "mesh", label: t("appearanceSection.shades") },
    { value: "solid", label: t("appearanceSection.solid") },
  ];
  const FONTS: { value: UiFont; label: string }[] = [
    { value: "system", label: t("appearanceSection.system") },
    { value: "rounded", label: t("appearanceSection.rounded") },
    { value: "serif", label: "Serif" },
    { value: "mono", label: "Mono" },
  ];

  /** The language choices, each in its own language (ADR-052). */
  const LANGUAGES: { value: LanguageSetting; label: string }[] = LANGUAGE_SETTINGS.map((value) => ({ value, label: t(`language.${value}`) }));

  const s = $derived(settings.current);
  const update = (patch: SettingsPatch) => settings.update(patch);

  const accentSwatches = ACCENT_PRESETS.map((preset) => ({
    ...preset,
    color: preset.accent,
    gradient: `linear-gradient(135deg, ${preset.accent} 45%, ${preset.accent2})`,
  }));
  const secondarySwatches = $derived(
    [...new Set(ACCENT_PRESETS.map((preset) => preset.accent2))].map((color) => ({ name: color, color })),
  );
</script>

<Row anchor="language" label={t("language.label")} hint={t("language.hint")} keywords={t("language.keywords")}>
  <Segmented
    label={t("language.label")}
    value={s.appearance.language}
    options={LANGUAGES}
    onchange={(language) => update({ appearance: { language } })}
  />
</Row>
<Row anchor="theme" label={t("appearanceSection.mode")} hint={t("appearanceSection.lightDarkFollowingSystem")} keywords={t("appearanceSection.themeLightDarkSystem")} stacked>
<div class="modes" role="radiogroup" aria-label={t("appearanceSection.theme")}>
  {#each MODES as mode (mode.value)}
    <button
      class="mode"
      role="radio"
      aria-checked={s.appearance.mode === mode.value}
      onclick={() => update({ appearance: { mode: mode.value } })}
    >
      <span class="frame">
        {#if mode.value === "system"}
          <span class="half"><MiniBrowser settings={s} mode="light" /></span>
          <span class="half dark"><MiniBrowser settings={s} mode="dark" /></span>
        {:else}
          <MiniBrowser settings={s} mode={mode.value} />
        {/if}
      </span>
      <span class="caption"><Icon name={mode.icon} size={12} /> {mode.label}</span>
    </button>
  {/each}
</div>
</Row>

<ThemeShare />
<Row anchor="accent" label={t("appearanceSection.accentColor")} hint={t("appearanceSection.buttonsSelectionFocusBackground")}>
  <ColorPicker
    label={t("appearanceSection.accentColor")}
    value={s.appearance.accent}
    swatches={accentSwatches}
    onselect={(preset) => update({ appearance: { accent: preset.accent, accent2: preset.accent2 } })}
    onchange={(hex) => update({ appearance: { accent: hex } })}
  />
</Row>
<Row anchor="secondary" label={t("appearanceSection.secondaryColor")} hint={t("appearanceSection.secondHueGradients")}>
  <ColorPicker
    label={t("appearanceSection.secondaryColor")}
    value={s.appearance.accent2}
    swatches={secondarySwatches}
    onselect={(swatch) => update({ appearance: { accent2: swatch.color } })}
    onchange={(hex) => update({ appearance: { accent2: hex } })}
  />
</Row>
<Row
  anchor="dynamic-theme"
  label={t("appearanceSection.dynamicTheme")}
  hint={t("appearanceSection.accentTakesColorSite")}
>
  <Toggle label={t("appearanceSection.dynamicTheme")} checked={s.appearance.dynamicTheme} onchange={(dynamicTheme) => update({ appearance: { dynamicTheme } })} />
</Row>
{#if window.platform === "win32"}
  <Row anchor="mica" label={t("appearanceSection.micaEffect")} hint={t("appearanceSection.windows11DesktopBackground")}>
    <Toggle label={t("appearanceSection.micaEffect")} checked={s.appearance.mica} onchange={(mica) => update({ appearance: { mica } })} />
  </Row>
{/if}
<Row anchor="background" label={t("appearanceSection.background")} hint={t("appearanceSection.windowBackgroundAroundPage")}>
  <div class="tiles" role="radiogroup" aria-label={t("appearanceSection.background")}>
    {#each BACKGROUNDS as option (option.value)}
      <button
        class="tile"
        role="radio"
        aria-checked={s.appearance.background === option.value}
        onclick={() => update({ appearance: { background: option.value } })}
      >
        <span class="sample" style:background={backdrop(option.value, settings.mode)}></span>
        {option.label}
      </button>
    {/each}
  </div>
</Row>
<Row anchor="font" label={t("appearanceSection.interfaceFont")}>
  <div class="tiles" role="radiogroup" aria-label={t("appearanceSection.interfaceFont")}>
    {#each FONTS as option (option.value)}
      <button
        class="tile font"
        role="radio"
        aria-checked={s.appearance.font === option.value}
        onclick={() => update({ appearance: { font: option.value } })}
      >
        <span class="aa" style:font-family={FONT_STACKS[option.value]}>Aa</span>
        {option.label}
      </button>
    {/each}
  </div>
</Row>
<Row anchor="density" label={t("appearanceSection.density")} hint={t("appearanceSection.heightTabsControls")}>
  <Segmented
    label={t("appearanceSection.density")}
    value={s.appearance.density}
    options={[
      { value: "compact" as Density, label: t("appearanceSection.compact") },
      { value: "comfortable" as Density, label: t("appearanceSection.comfortable") },
      { value: "spacious" as Density, label: t("appearanceSection.spacious") },
    ]}
    onchange={(density) => update({ appearance: { density } })}
  />
</Row>
<Row anchor="radius" label={t("appearanceSection.cornerRadius")}>
  <Slider
    label={t("appearanceSection.cornerRadius")}
    value={s.appearance.radius}
    min={LIMITS.radius.min}
    max={LIMITS.radius.max}
    onchange={(radius) => update({ appearance: { radius } })}
  />
</Row>
<Row anchor="shadows" label={t("appearanceSection.shadows")} hint={t("appearanceSection.dropShadowPageWindow")}>
  <Toggle label={t("appearanceSection.shadows")} checked={s.appearance.shadows} onchange={(shadows) => update({ appearance: { shadows } })} />
</Row>
<Row anchor="reduce-motion" label={t("appearanceSection.reduceMotion")} hint={t("appearanceSection.turnsOffTransitionsAnimations")}>
  <Toggle
    label={t("appearanceSection.reduceMotion")}
    checked={s.appearance.reduceMotion}
    onchange={(reduceMotion) => update({ appearance: { reduceMotion } })}
  />
</Row>
<Row anchor="hand-cursor" label={t("appearanceSection.handCursor")} hint={t("appearanceSection.handShapedPointerInterfaces")}>
  <Toggle
    label={t("appearanceSection.handCursor")}
    checked={s.appearance.pointerCursor}
    onchange={(pointerCursor) => update({ appearance: { pointerCursor } })}
  />
</Row>
<Row
  anchor="page-zoom"
  label={t("appearanceSection.defaultZoom")}
  hint={t("appearanceSection.sizeWebPagesZoom", { p: platform.shortcut('zoom-in'), p2: platform.shortcut('zoom-out') })}
  id="page-zoom"
>
  <select
    id="page-zoom"
    class="ui-field select"
    value={s.appearance.pageZoom}
    onchange={(event) => update({ appearance: { pageZoom: Number(event.currentTarget.value) } })}
  >
    {#each PAGE_ZOOM_LEVELS as level (level)}
      <option value={level}>{level}&#8239;%</option>
    {/each}
  </select>
</Row>

<style>
  /* Theme mode cards with a live miniature of the browser. */
  .modes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-3);
  }
  .mode {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0;
    color: var(--text-muted);
  }
  .frame {
    position: relative;
    display: block;
    overflow: hidden;
    aspect-ratio: 16 / 10;
    border-radius: var(--radius-md);
    box-shadow:
      0 0 0 1px var(--border),
      0 6px 18px -10px rgb(0 0 0 / 0.5);
    transition: box-shadow var(--motion-fast) var(--ease);
  }
  .mode:hover .frame {
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--accent) 50%, transparent),
      0 6px 18px -10px rgb(0 0 0 / 0.5);
  }
  .mode[aria-checked="true"] .frame {
    box-shadow:
      0 0 0 2px var(--accent-text),
      0 8px 24px -10px color-mix(in oklab, var(--accent) 60%, transparent);
  }
  .mode[aria-checked="true"] {
    color: var(--text);
  }
  .half {
    position: absolute;
    inset: 0;
  }
  .half.dark {
    clip-path: polygon(58% 0, 100% 0, 100% 100%, 42% 100%);
  }
  .caption {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: var(--text-xs);
  }

  /* Picture tiles (background style, font). */
  .tiles {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 76px;
    padding: 6px 6px 8px;
    border-radius: var(--radius-md);
    color: var(--text-muted);
    font-size: var(--text-xs);
    box-shadow: inset 0 0 0 1px var(--border);
    transition:
      background var(--motion-fast) var(--ease),
      box-shadow var(--motion-fast) var(--ease);
  }
  .tile:hover {
    background: var(--surface-hover);
  }
  .tile[aria-checked="true"] {
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    color: var(--text);
    box-shadow: inset 0 0 0 2px var(--accent-text);
  }
  .sample {
    width: 100%;
    height: 38px;
    border-radius: var(--radius-sm);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .aa {
    display: grid;
    place-items: center;
    width: 100%;
    height: 38px;
    color: var(--text);
    font-size: var(--text-lg);
  }
  .ui-field.select {
    width: 110px;
    padding-right: 6px;
  }
</style>
