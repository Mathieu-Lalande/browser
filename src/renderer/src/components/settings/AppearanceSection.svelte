<script lang="ts">
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
    { value: "system", label: "Système", icon: "monitor" },
    { value: "light", label: "Clair", icon: "sun" },
    { value: "dark", label: "Sombre", icon: "moon" },
  ];
  const BACKGROUNDS: { value: BackgroundStyle; label: string }[] = [
    { value: "gradient", label: "Dégradé" },
    { value: "mesh", label: "Nuances" },
    { value: "solid", label: "Uni" },
  ];
  const FONTS: { value: UiFont; label: string }[] = [
    { value: "system", label: "Système" },
    { value: "rounded", label: "Arrondie" },
    { value: "serif", label: "Serif" },
    { value: "mono", label: "Mono" },
  ];

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

<Row anchor="theme" label="Mode" hint="Clair, sombre, ou selon le réglage du système." keywords="thème clair sombre système dark light" stacked>
<div class="modes" role="radiogroup" aria-label="Thème">
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
<Row anchor="accent" label="Couleur d'accent" hint="Boutons, sélection, focus et reflets de l'arrière-plan.">
  <ColorPicker
    label="Couleur d'accent"
    value={s.appearance.accent}
    swatches={accentSwatches}
    onselect={(preset) => update({ appearance: { accent: preset.accent, accent2: preset.accent2 } })}
    onchange={(hex) => update({ appearance: { accent: hex } })}
  />
</Row>
<Row anchor="secondary" label="Couleur secondaire" hint="Seconde teinte des dégradés.">
  <ColorPicker
    label="Couleur secondaire"
    value={s.appearance.accent2}
    swatches={secondarySwatches}
    onselect={(swatch) => update({ appearance: { accent2: swatch.color } })}
    onchange={(hex) => update({ appearance: { accent2: hex } })}
  />
</Row>
<Row
  anchor="dynamic-theme"
  label="Thème dynamique"
  hint="L'accent prend la couleur du site affiché (couleur de thème ou de son icône), ajustée pour rester lisible. Sinon, la couleur de l'espace."
>
  <Toggle label="Thème dynamique" checked={s.appearance.dynamicTheme} onchange={(dynamicTheme) => update({ appearance: { dynamicTheme } })} />
</Row>
{#if window.platform === "win32"}
  <Row anchor="mica" label="Effet Mica" hint="Windows 11 : le fond du bureau transparaît, discrètement, derrière la barre latérale. Sans effet sous Windows 10.">
    <Toggle label="Effet Mica" checked={s.appearance.mica} onchange={(mica) => update({ appearance: { mica } })} />
  </Row>
{/if}
<Row anchor="background" label="Arrière-plan" hint="Fond de la fenêtre, autour de la page.">
  <div class="tiles" role="radiogroup" aria-label="Arrière-plan">
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
<Row anchor="font" label="Police de l'interface">
  <div class="tiles" role="radiogroup" aria-label="Police de l'interface">
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
<Row anchor="density" label="Densité" hint="Hauteur des onglets et des contrôles.">
  <Segmented
    label="Densité"
    value={s.appearance.density}
    options={[
      { value: "compact" as Density, label: "Compacte" },
      { value: "comfortable" as Density, label: "Confortable" },
      { value: "spacious" as Density, label: "Aérée" },
    ]}
    onchange={(density) => update({ appearance: { density } })}
  />
</Row>
<Row anchor="radius" label="Arrondi des coins">
  <Slider
    label="Arrondi des coins"
    value={s.appearance.radius}
    min={LIMITS.radius.min}
    max={LIMITS.radius.max}
    onchange={(radius) => update({ appearance: { radius } })}
  />
</Row>
<Row anchor="shadows" label="Ombres" hint="Ombre portée de la page et de la fenêtre.">
  <Toggle label="Ombres" checked={s.appearance.shadows} onchange={(shadows) => update({ appearance: { shadows } })} />
</Row>
<Row anchor="reduce-motion" label="Réduire les animations" hint="Coupe transitions et animations, en plus du réglage du système.">
  <Toggle
    label="Réduire les animations"
    checked={s.appearance.reduceMotion}
    onchange={(reduceMotion) => update({ appearance: { reduceMotion } })}
  />
</Row>
<Row anchor="hand-cursor" label="Curseur main" hint="Pointeur en forme de main sur les boutons, onglets et liens de l'interface.">
  <Toggle
    label="Curseur main"
    checked={s.appearance.pointerCursor}
    onchange={(pointerCursor) => update({ appearance: { pointerCursor } })}
  />
</Row>
<Row
  anchor="page-zoom"
  label="Zoom par défaut"
  hint="Taille des pages web. Le zoom choisi sur un site ({platform.shortcut('zoom-in')} / {platform.shortcut('zoom-out')}) est mémorisé pour ce site."
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
