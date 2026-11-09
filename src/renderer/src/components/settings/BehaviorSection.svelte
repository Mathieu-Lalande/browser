<script lang="ts">
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
  label="Au démarrage"
  hint="Les onglets reviennent chargés à la demande. Après un plantage, la page d'accueil propose de restaurer la session."
  keywords="restaurer la session reprendre"
>
  <Segmented
    label="Au démarrage"
    value={s.behavior.restoreSession ? "resume" : "home"}
    options={[
      { value: "resume", label: "Reprendre où j'en étais" },
      { value: "home", label: "Page d'accueil" },
    ]}
    onchange={(choice) => update({ behavior: { restoreSession: choice === "resume" } })}
  />
</Row>
<Row anchor="new-tab-position" label="Ouvrir les nouveaux onglets">
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
<Row anchor="after-close" label="Après la fermeture d'un onglet, afficher">
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
  anchor="mini-window"
  label="Ouvrir les liens externes dans une mini-fenêtre"
  hint="Un lien ouvert depuis une autre application s'affiche dans une petite fenêtre. « Ouvrir dans le navigateur » (Ctrl+O) le garde dans un onglet ; la fermer l'oublie."
>
  <Toggle
    label="Ouvrir les liens externes dans une mini-fenêtre"
    checked={s.behavior.externalLinksInMiniWindow}
    onchange={(externalLinksInMiniWindow) => update({ behavior: { externalLinksInMiniWindow } })}
  />
</Row>
<Row
  anchor="sleep"
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
<Row
  anchor="energy-saver"
  label="Économiseur d'énergie"
  hint="Onglets mis en veille au bout de 5 min au plus, pages en arrière-plan ralenties, aperçus moins fréquents, animations coupées. Une icône le signale dans la barre de fenêtre."
  keywords="batterie autonomie"
>
  <Segmented
    label="Économiseur d'énergie"
    value={s.behavior.energySaver}
    options={ENERGY_SAVER_OPTIONS.map((option) => ({ value: option.value as EnergySaverMode, label: option.label }))}
    onchange={(energySaver) => update({ behavior: { energySaver } })}
  />
</Row>
<Row
  anchor="archive"
  label="Archiver les onglets inactifs après"
  hint="L'onglet est fermé et rangé dans les onglets archivés, d'où il se restaure. Jamais pour un onglet épinglé, favori, qui joue du son ou dans une vue scindée."
>
  <Segmented
    label="Archiver les onglets inactifs après"
    value={s.behavior.archiveTabsAfter}
    options={ARCHIVE_DELAY_OPTIONS.map((option) => ({ value: option.value as TabArchiveDelay, label: option.label }))}
    onchange={(archiveTabsAfter) => update({ behavior: { archiveTabsAfter } })}
  />
</Row>
<Row
  anchor="auto-pip"
  label="Image dans l'image automatique"
  hint="Quand vous quittez un onglet qui lit une vidéo visible, elle continue dans une fenêtre flottante, et revient à sa place à votre retour. Les sites qui interdisent l'image dans l'image sont respectés."
  keywords="pip picture in picture vidéo flottante"
>
  <Toggle
    label="Image dans l'image automatique"
    checked={s.media.autoPictureInPicture}
    onchange={(autoPictureInPicture) => update({ media: { autoPictureInPicture } })}
  />
</Row>
<Row label="Onglets archivés" hint="Les onglets fermés par l'archivage, à restaurer ou supprimer.">
  <Button icon="archive" onclick={() => api.commands.run("open-archive")}>Voir les onglets archivés</Button>
</Row>
<Row label="Extensions" hint="Installer, activer ou retirer des extensions." keywords="modules addons">
  <Button icon="extension" onclick={() => api.commands.run("open-extensions")}>Gérer les extensions</Button>
</Row>
