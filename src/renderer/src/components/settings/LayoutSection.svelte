<script lang="ts">
  import { LIMITS, type SettingsPatch, type SidebarPosition } from "@shared/settings";
  import { platform } from "../../lib/platform.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Row from "../ui/Row.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import Slider from "./Slider.svelte";

  /** Settings > Disposition: sidebar side and width, page margin, zen mode, tab previews. */

  const s = $derived(settings.current);
  const update = (patch: SettingsPatch) => settings.update(patch);
</script>

<Row anchor="sidebar-position" label="Position de la barre latérale">
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
<Row anchor="sidebar-width" label="Largeur de la barre latérale" hint="Se règle aussi en faisant glisser son bord.">
  <Slider
    label="Largeur de la barre latérale"
    value={s.layout.sidebarWidth}
    min={LIMITS.sidebarWidth.min}
    max={LIMITS.sidebarWidth.max}
    step={4}
    onchange={(sidebarWidth) => update({ layout: { sidebarWidth } })}
  />
</Row>
<Row anchor="gutter" label="Marge autour de la page" hint="0 pour une page bord à bord.">
  <Slider
    label="Marge autour de la page"
    value={s.layout.gutter}
    min={LIMITS.gutter.min}
    max={LIMITS.gutter.max}
    onchange={(gutter) => update({ layout: { gutter } })}
  />
</Row>
<Row
  anchor="zen"
  label="Mode zen"
  hint="Masque la barre latérale et affiche la page bord à bord. Survolez le bord de la fenêtre pour la faire apparaître. Raccourci : {platform.shortcut('toggle-zen')}."
>
  <Toggle label="Mode zen" checked={s.layout.zenMode} onchange={(zenMode) => update({ layout: { zenMode } })} />
</Row>
<Row
  anchor="tab-preview"
  label="Aperçu des onglets au survol"
  hint="Survoler un onglet, un favori ou une icône du rail affiche une carte : miniature, titre, site, son et veille."
>
  <Toggle
    label="Aperçu des onglets au survol"
    checked={s.layout.tabHoverPreview}
    onchange={(tabHoverPreview) => update({ layout: { tabHoverPreview } })}
  />
</Row>
