<script lang="ts">
  import {
    ACCENT_PRESETS,
    LIMITS,
    PAGE_ZOOM_LEVELS,
    type BackgroundStyle,
    type CloseTabActivates,
    type Density,
    type NewTabPosition,
    type SettingsPatch,
    type SidebarPosition,
    type StartBackground,
    type TabSleepDelay,
    type ThemeMode,
    type UiFont,
  } from "@shared/settings";
  import { FONT_STACKS, backdrop } from "@shared/theme";
  import { SEARCH_ENGINES } from "@shared/url";
  import { settings } from "../../lib/settings.svelte";
  import Icon, { type IconName } from "../Icon.svelte";
  import ColorPicker from "./ColorPicker.svelte";
  import DataSection from "./DataSection.svelte";
  import DownloadsSection from "./DownloadsSection.svelte";
  import MiniBrowser from "./MiniBrowser.svelte";
  import Row from "./Row.svelte";
  import Section from "./Section.svelte";
  import Segmented from "./Segmented.svelte";
  import Slider from "./Slider.svelte";
  import Toggle from "./Toggle.svelte";

  const NAV: { id: string; label: string; icon: IconName }[] = [
    { id: "appearance", label: "Apparence", icon: "palette" },
    { id: "layout", label: "Disposition", icon: "sidebar" },
    { id: "search", label: "Recherche", icon: "search" },
    { id: "startPage", label: "Page d'accueil", icon: "home" },
    { id: "behavior", label: "Comportement", icon: "sliders" },
    { id: "privacy", label: "Confidentialité", icon: "shield" },
    { id: "downloads", label: "Téléchargements", icon: "download" },
    { id: "data", label: "Données", icon: "database" },
  ];

  const MODES: { value: ThemeMode; label: string; icon: IconName }[] = [
    { value: "system", label: "Système", icon: "monitor" },
    { value: "light", label: "Clair", icon: "sun" },
    { value: "dark", label: "Sombre", icon: "moon" },
  ];
  const BACKGROUNDS: { value: BackgroundStyle; label: string }[] = [
    { value: "gradient", label: "Dégradé" },
    { value: "mesh", label: "Mesh" },
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

  let content: HTMLElement;
  let inner: HTMLElement;
  let current = $state("appearance");
  /** Section the user jumped to: kept highlighted until the scroll it started settles. */
  let jumping: string | null = null;
  let jumpTimer: ReturnType<typeof setTimeout> | undefined;
  /** Room after the last section, so every section (the last ones too) can scroll to the top. */
  let tail = $state(0);
  /** URL field of the start page image: saved once complete (on change), not on every keystroke. */
  let imageDraft = $state<string | null>(null);
  let imageError = $state(false);

  // Highlight the section being read in the side navigation: the last one whose title passed
  // the top third, or the last one once scrolled to the bottom.
  function onScroll(): void {
    if (jumping) return;
    const sections = [...content.querySelectorAll<HTMLElement>("[data-section]")];
    const top = content.getBoundingClientRect().top + content.clientHeight / 3;
    const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 4;
    const reading = atBottom ? sections.at(-1) : sections.filter((section) => section.getBoundingClientRect().top <= top).at(-1);
    current = reading?.dataset.section ?? NAV[0].id;
  }

  function jump(id: string): void {
    const section = content.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!section) return;
    current = id;
    jumping = id;
    const settle = () => {
      clearTimeout(jumpTimer);
      jumping = null;
    };
    content.addEventListener("scrollend", settle, { once: true });
    // No scrollend when the content was already there; never keep the scroll spy off for long.
    clearTimeout(jumpTimer);
    jumpTimer = setTimeout(settle, 1000);
    const margin = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
    const top = section.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop - margin;
    // Only the settings column scrolls: scrollIntoView would also nudge its scrollable ancestors.
    content.scrollTo({ top, behavior: s.appearance.reduceMotion ? "auto" : "smooth" });
  }

  $effect(() => {
    const measure = () => {
      const last = [...inner.querySelectorAll<HTMLElement>("[data-section]")].at(-1);
      if (!last) return;
      const margin = parseFloat(getComputedStyle(last).scrollMarginTop) || 0;
      const below = inner.getBoundingClientRect().bottom - last.getBoundingClientRect().top;
      tail = Math.max(0, Math.ceil(content.clientHeight - margin - below));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(inner);
    return () => {
      observer.disconnect();
      clearTimeout(jumpTimer);
    };
  });

  function commitImage(event: Event & { currentTarget: HTMLInputElement }): void {
    const value = event.currentTarget.value.trim();
    imageError = value !== "" && !/^https:\/\/\S+$/i.test(value);
    if (imageError) return;
    imageDraft = null;
    update({ startPage: { backgroundImage: value } });
  }
</script>

<div class="settings">
  <nav class="toc" aria-label="Sections des paramètres">
    <h1>Paramètres</h1>
    {#each NAV as item (item.id)}
      <button class:current={current === item.id} aria-current={current === item.id ? "true" : undefined} onclick={() => jump(item.id)}>
        <Icon name={item.icon} size={16} />
        {item.label}
      </button>
    {/each}
    <button class="reset-all" onclick={() => settings.reset()}>
      <Icon name="reset" size={12} /> Tout réinitialiser
    </button>
  </nav>

  <div class="content" bind:this={content} onscroll={onScroll}>
    <div class="inner" bind:this={inner}>
      <Section
        id="appearance"
        icon="palette"
        title="Apparence"
        description="Couleurs, ambiance et typographie de l'interface."
        onReset={() => settings.reset("appearance")}
      >
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

        <Row label="Couleur d'accent" hint="Boutons, sélection, focus et reflets de l'arrière-plan.">
          <ColorPicker
            label="Couleur d'accent"
            value={s.appearance.accent}
            swatches={accentSwatches}
            onselect={(preset) => update({ appearance: { accent: preset.accent, accent2: preset.accent2 } })}
            onchange={(hex) => update({ appearance: { accent: hex } })}
          />
        </Row>
        <Row label="Couleur secondaire" hint="Seconde teinte des dégradés.">
          <ColorPicker
            label="Couleur secondaire"
            value={s.appearance.accent2}
            swatches={secondarySwatches}
            onselect={(swatch) => update({ appearance: { accent2: swatch.color } })}
            onchange={(hex) => update({ appearance: { accent2: hex } })}
          />
        </Row>
        <Row label="Arrière-plan" hint="Fond de la fenêtre, autour de la page.">
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
        <Row label="Police de l'interface">
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
        <Row label="Densité" hint="Hauteur des onglets et des contrôles.">
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
        <Row label="Arrondi des coins">
          <Slider
            label="Arrondi des coins"
            value={s.appearance.radius}
            min={LIMITS.radius.min}
            max={LIMITS.radius.max}
            onchange={(radius) => update({ appearance: { radius } })}
          />
        </Row>
        <Row label="Ombres" hint="Ombre portée de la page et de la fenêtre.">
          <Toggle label="Ombres" checked={s.appearance.shadows} onchange={(shadows) => update({ appearance: { shadows } })} />
        </Row>
        <Row label="Réduire les animations" hint="Coupe transitions et animations, en plus du réglage du système.">
          <Toggle
            label="Réduire les animations"
            checked={s.appearance.reduceMotion}
            onchange={(reduceMotion) => update({ appearance: { reduceMotion } })}
          />
        </Row>
        <Row label="Curseur main" hint="Pointeur en forme de main sur les boutons, onglets et liens de l'interface.">
          <Toggle
            label="Curseur main"
            checked={s.appearance.pointerCursor}
            onchange={(pointerCursor) => update({ appearance: { pointerCursor } })}
          />
        </Row>
        <Row label="Zoom par défaut" hint="Taille des pages web. Le zoom choisi sur un site (Ctrl+ / Ctrl−) est mémorisé pour ce site." id="page-zoom">
          <select
            id="page-zoom"
            class="field select"
            value={s.appearance.pageZoom}
            onchange={(event) => update({ appearance: { pageZoom: Number(event.currentTarget.value) } })}
          >
            {#each PAGE_ZOOM_LEVELS as level (level)}
              <option value={level}>{level} %</option>
            {/each}
          </select>
        </Row>
      </Section>

      <Section
        id="layout"
        icon="sidebar"
        title="Disposition"
        description="Place de la barre latérale et de la page."
        onReset={() => settings.reset("layout")}
      >
        <Row label="Position de la barre latérale">
          <Segmented
            label="Position de la barre latérale"
            value={s.layout.sidebarPosition}
            options={[
              { value: "left" as SidebarPosition, label: "Gauche" },
              { value: "right" as SidebarPosition, label: "Droite" },
            ]}
            onchange={(sidebarPosition) => update({ layout: { sidebarPosition } })}
          />
        </Row>
        <Row label="Largeur de la barre latérale" hint="Se règle aussi en faisant glisser son bord.">
          <Slider
            label="Largeur de la barre latérale"
            value={s.layout.sidebarWidth}
            min={LIMITS.sidebarWidth.min}
            max={LIMITS.sidebarWidth.max}
            step={4}
            onchange={(sidebarWidth) => update({ layout: { sidebarWidth } })}
          />
        </Row>
        <Row label="Marge autour de la page" hint="0 pour une page bord à bord.">
          <Slider
            label="Marge autour de la page"
            value={s.layout.gutter}
            min={LIMITS.gutter.min}
            max={LIMITS.gutter.max}
            onchange={(gutter) => update({ layout: { gutter } })}
          />
        </Row>
        <Row
          label="Mode zen"
          hint="Masque la barre latérale et affiche la page bord à bord. Survolez le bord de la fenêtre pour la faire apparaître. Raccourci : Ctrl+Maj+B."
        >
          <Toggle label="Mode zen" checked={s.layout.zenMode} onchange={(zenMode) => update({ layout: { zenMode } })} />
        </Row>
      </Section>

      <Section
        id="search"
        icon="search"
        title="Recherche"
        description="Moteur utilisé par la barre d'adresse et la page d'accueil."
        onReset={() => settings.reset("search")}
      >
        <div class="engines" role="radiogroup" aria-label="Moteur de recherche">
          {#each SEARCH_ENGINES as engine (engine.id)}
            <button
              class="engine"
              role="radio"
              aria-checked={s.search.engine === engine.id}
              onclick={() => update({ search: { engine: engine.id } })}
            >
              <span class="radio"></span>
              <span class="engine-name">{engine.name}</span>
              <span class="engine-host">{new URL(engine.template).hostname.replace(/^www\./, "")}</span>
            </button>
          {/each}
        </div>
      </Section>

      <Section
        id="startPage"
        icon="home"
        title="Page d'accueil"
        description="Ce qu'affiche un nouvel onglet."
        onReset={() => settings.reset("startPage")}
      >
        <Row label="Prénom" hint="Pour un accueil personnalisé : « Bonjour, Mathieu. »" id="greeting-name">
          <input
            id="greeting-name"
            class="field"
            value={s.startPage.greetingName}
            maxlength={LIMITS.greetingName}
            placeholder="Votre prénom"
            autocomplete="off"
            oninput={(event) => update({ startPage: { greetingName: event.currentTarget.value } })}
          />
        </Row>
        <Row label="Horloge">
          <Toggle label="Horloge" checked={s.startPage.showClock} onchange={(showClock) => update({ startPage: { showClock } })} />
        </Row>
        <Row label="Sites les plus visités">
          <Toggle
            label="Sites les plus visités"
            checked={s.startPage.showTopSites}
            onchange={(showTopSites) => update({ startPage: { showTopSites } })}
          />
        </Row>
        <Row label="Fond" hint={s.startPage.background === "image" ? "Adresse https d'une image." : undefined}>
          <div class="stack">
            <Segmented
              label="Fond de la page d'accueil"
              value={s.startPage.background}
              options={[
                { value: "theme" as StartBackground, label: "Thème" },
                { value: "aurora" as StartBackground, label: "Aurore" },
                { value: "image" as StartBackground, label: "Image" },
              ]}
              onchange={(background) => update({ startPage: { background } })}
            />
            {#if s.startPage.background === "image"}
              <input
                class="field wide"
                class:invalid={imageError}
                type="url"
                value={imageDraft ?? s.startPage.backgroundImage}
                placeholder="https://…/image.jpg"
                aria-label="Adresse de l'image de fond"
                aria-invalid={imageError}
                spellcheck="false"
                oninput={(event) => ((imageDraft = event.currentTarget.value), (imageError = false))}
                onchange={commitImage}
              />
            {/if}
          </div>
        </Row>
      </Section>

      <Section
        id="behavior"
        icon="sliders"
        title="Comportement"
        description="Démarrage et gestion des onglets."
        onReset={() => settings.reset("behavior")}
      >
        <Row label="Restaurer la session au démarrage" hint="Rouvre les onglets de la dernière fois (chargés à la demande).">
          <Toggle
            label="Restaurer la session au démarrage"
            checked={s.behavior.restoreSession}
            onchange={(restoreSession) => update({ behavior: { restoreSession } })}
          />
        </Row>
        <Row label="Ouvrir les nouveaux onglets">
          <Segmented
            label="Ouvrir les nouveaux onglets"
            value={s.behavior.newTabPosition}
            options={[
              { value: "end" as NewTabPosition, label: "À la fin" },
              { value: "next" as NewTabPosition, label: "Après l'onglet actif" },
            ]}
            onchange={(newTabPosition) => update({ behavior: { newTabPosition } })}
          />
        </Row>
        <Row label="Après la fermeture d'un onglet, afficher">
          <Segmented
            label="Après la fermeture d'un onglet, afficher"
            value={s.behavior.closeTabActivates}
            options={[
              { value: "next" as CloseTabActivates, label: "Le suivant" },
              { value: "previous" as CloseTabActivates, label: "Le précédent" },
              { value: "recent" as CloseTabActivates, label: "Le dernier utilisé" },
            ]}
            onchange={(closeTabActivates) => update({ behavior: { closeTabActivates } })}
          />
        </Row>
        <Row
          label="Mettre en veille les onglets inactifs après"
          hint="Libère la mémoire : la page se recharge quand vous revenez sur l'onglet. Jamais pour un onglet qui joue du son ou un formulaire en cours."
        >
          <Segmented
            label="Mettre en veille les onglets inactifs après"
            value={s.behavior.sleepTabsAfter}
            options={[
              { value: "never" as TabSleepDelay, label: "Jamais" },
              { value: "15m" as TabSleepDelay, label: "15 min" },
              { value: "30m" as TabSleepDelay, label: "30 min" },
              { value: "1h" as TabSleepDelay, label: "1 h" },
              { value: "2h" as TabSleepDelay, label: "2 h" },
            ]}
            onchange={(sleepTabsAfter) => update({ behavior: { sleepTabsAfter } })}
          />
        </Row>
      </Section>

      <Section
        id="privacy"
        icon="shield"
        title="Confidentialité"
        description="Ce que le navigateur révèle de vous aux sites."
        onReset={() => settings.reset("privacy")}
      >
        <Row
          label="Uniformiser la langue envoyée aux sites"
          hint="Annonce « en-US, en » comme la majorité des navigateurs, pour moins se distinguer. Les sites peuvent alors s'afficher en anglais."
        >
          <Toggle
            label="Uniformiser la langue envoyée aux sites"
            checked={s.privacy.normalizeAcceptLanguage}
            onchange={(normalizeAcceptLanguage) => update({ privacy: { normalizeAcceptLanguage } })}
          />
        </Row>
      </Section>

      <Section
        id="downloads"
        icon="download"
        title="Téléchargements"
        description="Où vont les fichiers, et comment."
        onReset={() => settings.reset("downloads")}
      >
        <DownloadsSection />
      </Section>

      <Section id="data" icon="database" title="Données" description="Historique et favoris, stockés uniquement sur cet appareil.">
        <DataSection />
      </Section>
    </div>
    <div class="tail" style:height="{tail}px" aria-hidden="true"></div>
  </div>
</div>

<style>
  .settings {
    display: flex;
    height: 100%;
    animation: rise 0.3s var(--ease);
  }
  .toc {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 2px;
    width: 210px;
    padding: 28px 12px 16px;
    border-right: 1px solid var(--border);
  }
  h1 {
    margin: 0 10px 18px;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.03em;
  }
  .toc button {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    color: var(--text-muted);
    text-align: left;
  }
  .toc button:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .toc button.current {
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: var(--text);
  }
  .toc button.current :global(svg) {
    color: var(--accent-text);
  }
  .toc .reset-all {
    margin-top: auto;
    font-size: 12px;
  }
  .content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  }
  .content::-webkit-scrollbar {
    width: 10px;
  }
  .content::-webkit-scrollbar-thumb {
    border: 3px solid transparent;
    border-radius: 5px;
    background: var(--surface-active) padding-box;
  }
  .content::-webkit-scrollbar-thumb:hover {
    background-color: var(--text-faint);
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 36px;
    max-width: 760px;
    margin: 0 auto;
    padding: 32px 32px 64px;
    user-select: none;
  }

  /* Theme mode cards with a live miniature of the browser. */
  .modes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    padding: 18px;
    border-bottom: 1px solid var(--border);
  }
  .mode {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0;
    color: var(--text-muted);
  }
  .frame {
    position: relative;
    display: block;
    overflow: hidden;
    aspect-ratio: 16 / 10;
    border-radius: calc(var(--radius) + 2px);
    box-shadow:
      0 0 0 1px var(--border),
      0 6px 18px -10px rgb(0 0 0 / 0.5);
    transition: box-shadow 0.15s var(--ease);
  }
  .mode:hover .frame {
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--accent) 50%, transparent),
      0 6px 18px -10px rgb(0 0 0 / 0.5);
  }
  .mode[aria-checked="true"] .frame {
    box-shadow:
      0 0 0 2px var(--accent),
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
    font-size: 12.5px;
  }

  /* Picture tiles (background style, font). */
  .tiles {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 76px;
    padding: 6px 6px 7px;
    border-radius: var(--radius);
    color: var(--text-muted);
    font-size: 12px;
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .tile:hover {
    background: var(--surface-hover);
  }
  .tile[aria-checked="true"] {
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    color: var(--text);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .sample {
    width: 100%;
    height: 38px;
    border-radius: calc(var(--radius) - 4px);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .aa {
    display: grid;
    place-items: center;
    width: 100%;
    height: 38px;
    color: var(--text);
    font-size: 20px;
  }

  /* Search engines. */
  .engines {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    padding: 16px 18px;
  }
  .engine {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: 12px;
    padding: 12px 14px;
    border-radius: var(--radius);
    text-align: left;
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .engine:hover {
    background: var(--surface-hover);
  }
  .engine[aria-checked="true"] {
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .radio {
    grid-row: span 2;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--text-faint);
  }
  .engine[aria-checked="true"] .radio {
    background: #fff;
    box-shadow: inset 0 0 0 5px var(--accent);
  }
  .engine-name {
    font-weight: 500;
  }
  .engine-host {
    color: var(--text-faint);
    font-size: 12px;
  }

  .stack {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }
  .field {
    width: 220px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    outline: 0;
    background: var(--surface);
    user-select: text;
    transition:
      border-color 0.15s var(--ease),
      box-shadow 0.15s var(--ease);
  }
  .field.wide {
    width: 300px;
  }
  .field.select {
    width: 110px;
    padding-right: 6px;
    color: inherit;
    font: inherit;
  }
  .field:focus {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent);
  }
  .field.invalid {
    border-color: #e5484d;
  }
  .field::placeholder {
    color: var(--text-faint);
  }

  @media (max-width: 760px) {
    .toc {
      display: none;
    }
    .modes {
      grid-template-columns: 1fr 1fr;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
