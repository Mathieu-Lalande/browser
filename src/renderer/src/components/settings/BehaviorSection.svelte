<script lang="ts">
  import { t } from "@shared/i18n";
  import { ENERGY_SAVER_OPTIONS, type EnergySaverMode } from "@shared/energy";
  import { ARCHIVE_DELAY_OPTIONS, type CloseTabActivates, type NewTabPosition, type SettingsPatch, type TabArchiveDelay, type TabSleepDelay } from "@shared/settings";
  import { api } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Button from "../ui/Button.svelte";
  import DefaultBrowserRow from "./DefaultBrowserRow.svelte";
  import Row from "../ui/Row.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /** Settings > Comportement: session restore, where tabs open, sleep and archiving, extensions. */

  const s = $derived(settings.current);
  const update = (patch: SettingsPatch) => settings.update(patch);
</script>

<DefaultBrowserRow />
<Row
  anchor="restore-session"
  label={t("behaviorSection.startup")}
  hint={t("behaviorSection.tabsComeBackLoaded")}
  keywords={t("behaviorSection.restoreSessionResume")}
>
  <Segmented
    label={t("behaviorSection.startup")}
    value={s.behavior.restoreSession ? "resume" : "home"}
    options={[
      { value: "resume", label: t("behaviorSection.continueWhereILeft") },
      { value: "home", label: t("behaviorSection.startPage") },
    ]}
    onchange={(choice) => update({ behavior: { restoreSession: choice === "resume" } })}
  />
</Row>
<Row anchor="new-tab-position" label={t("behaviorSection.openNewTabs")}>
  <Segmented
    label={t("behaviorSection.openNewTabs")}
    value={s.behavior.newTabPosition}
    options={[
      { value: "end" as NewTabPosition, label: t("behaviorSection.end") },
      { value: "next" as NewTabPosition, label: t("behaviorSection.afterActiveTab") },
    ]}
    onchange={(newTabPosition) => update({ behavior: { newTabPosition } })}
  />
</Row>
<Row anchor="after-close" label={t("behaviorSection.afterClosingTabShow")}>
  <Segmented
    label={t("behaviorSection.afterClosingTabShow")}
    value={s.behavior.closeTabActivates}
    options={[
      { value: "next" as CloseTabActivates, label: t("behaviorSection.nextOne") },
      { value: "previous" as CloseTabActivates, label: t("behaviorSection.previousOne") },
      { value: "recent" as CloseTabActivates, label: t("behaviorSection.lastUsedOne") },
    ]}
    onchange={(closeTabActivates) => update({ behavior: { closeTabActivates } })}
  />
</Row>
<Row
  anchor="mini-window"
  label={t("behaviorSection.openExternalLinksMini")}
  hint={t("behaviorSection.linkOpenedFromAnother")}
>
  <Toggle
    label={t("behaviorSection.openExternalLinksMini")}
    checked={s.behavior.externalLinksInMiniWindow}
    onchange={(externalLinksInMiniWindow) => update({ behavior: { externalLinksInMiniWindow } })}
  />
</Row>
<Row
  anchor="sleep"
  label={t("behaviorSection.putInactiveTabsSleep")}
  hint={t("behaviorSection.freesMemoryPageReloads")}
>
  <Segmented
    label={t("behaviorSection.putInactiveTabsSleep")}
    value={s.behavior.sleepTabsAfter}
    options={[
      { value: "never" as TabSleepDelay, label: t("behaviorSection.never") },
      { value: "15m" as TabSleepDelay, label: "15 min" },
      { value: "30m" as TabSleepDelay, label: "30 min" },
      { value: "1h" as TabSleepDelay, label: "1 h" },
      { value: "2h" as TabSleepDelay, label: "2 h" },
    ]}
    onchange={(sleepTabsAfter) => update({ behavior: { sleepTabsAfter } })}
  />
</Row>
<Row
  anchor="energy-saver"
  label={t("behaviorSection.energySaver")}
  hint={t("behaviorSection.tabsPutSleepAfter")}
  keywords={t("behaviorSection.batteryLifePower")}
>
  <Segmented
    label={t("behaviorSection.energySaver")}
    value={s.behavior.energySaver}
    options={ENERGY_SAVER_OPTIONS.map((option) => ({ value: option.value as EnergySaverMode, label: option.label }))}
    onchange={(energySaver) => update({ behavior: { energySaver } })}
  />
</Row>
<Row
  anchor="archive"
  label={t("behaviorSection.archiveInactiveTabsAfter")}
  hint={t("behaviorSection.tabClosedKeptArchived")}
>
  <Segmented
    label={t("behaviorSection.archiveInactiveTabsAfter")}
    value={s.behavior.archiveTabsAfter}
    options={ARCHIVE_DELAY_OPTIONS.map((option) => ({ value: option.value as TabArchiveDelay, label: option.label }))}
    onchange={(archiveTabsAfter) => update({ behavior: { archiveTabsAfter } })}
  />
</Row>
<Row
  anchor="auto-pip"
  label={t("behaviorSection.automaticPicturePicture")}
  hint={t("behaviorSection.whenYouLeaveTab")}
  keywords={t("behaviorSection.pipPicturePictureFloating")}
>
  <Toggle
    label={t("behaviorSection.automaticPicturePicture")}
    checked={s.media.autoPictureInPicture}
    onchange={(autoPictureInPicture) => update({ media: { autoPictureInPicture } })}
  />
</Row>
<Row label={t("behaviorSection.archivedTabs")} hint={t("behaviorSection.tabsClosedArchivingRestore")}>
  <Button icon="archive" onclick={() => api.commands.run("open-archive")}>{t("behaviorSection.seeArchivedTabs")}</Button>
</Row>
<Row label={t("behaviorSection.extensions")} hint={t("behaviorSection.installTurnRemoveExtensions")} keywords={t("behaviorSection.modulesAddonsAddOns")}>
  <Button icon="extension" onclick={() => api.commands.run("open-extensions")}>{t("behaviorSection.manageExtensions")}</Button>
</Row>
