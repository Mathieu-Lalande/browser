<script lang="ts">
  import { t } from "@shared/i18n";
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

<Row anchor="sidebar-position" label={t("layoutSection.sidebarPosition")}>
  <Segmented
    label={t("layoutSection.sidebarPosition")}
    value={s.layout.sidebarPosition}
    options={[
      { value: "left" as SidebarPosition, label: t("layoutSection.left") },
      { value: "right" as SidebarPosition, label: t("layoutSection.right") },
    ]}
    onchange={(sidebarPosition) => update({ layout: { sidebarPosition } })}
  />
</Row>
<Row anchor="sidebar-width" label={t("layoutSection.sidebarWidth")} hint={t("layoutSection.canAlsoAdjustedDragging")}>
  <Slider
    label={t("layoutSection.sidebarWidth")}
    value={s.layout.sidebarWidth}
    min={LIMITS.sidebarWidth.min}
    max={LIMITS.sidebarWidth.max}
    step={4}
    onchange={(sidebarWidth) => update({ layout: { sidebarWidth } })}
  />
</Row>
<Row anchor="gutter" label={t("layoutSection.marginAroundPage")} hint={t("layoutSection.n0EdgeEdgePage")}>
  <Slider
    label={t("layoutSection.marginAroundPage")}
    value={s.layout.gutter}
    min={LIMITS.gutter.min}
    max={LIMITS.gutter.max}
    onchange={(gutter) => update({ layout: { gutter } })}
  />
</Row>
<Row
  anchor="zen"
  label={t("layoutSection.zenMode")}
  hint={t("layoutSection.hidesSidebarShowsPage", { p: platform.shortcut('toggle-zen') })}
>
  <Toggle label={t("layoutSection.zenMode")} checked={s.layout.zenMode} onchange={(zenMode) => update({ layout: { zenMode } })} />
</Row>
<Row
  anchor="tab-preview"
  label={t("layoutSection.tabPreviewHover")}
  hint={t("layoutSection.hoveringTabFavoriteRail")}
>
  <Toggle
    label={t("layoutSection.tabPreviewHover")}
    checked={s.layout.tabHoverPreview}
    onchange={(tabHoverPreview) => update({ layout: { tabHoverPreview } })}
  />
</Row>
