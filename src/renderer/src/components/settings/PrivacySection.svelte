<script lang="ts">
  import type { SettingsPatch } from "@shared/settings";
  import { api } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Button from "../ui/Button.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import DrmRow from "./DrmRow.svelte";

  /** Settings > Confidentialité: language sent to sites, weather widget note, passwords. */

  const s = $derived(settings.current);
  const update = (patch: SettingsPatch) => settings.update(patch);
</script>

<Row
  anchor="accept-language"
  label="Uniformiser la langue envoyée aux sites"
  hint="Annonce « en-US, en » comme la majorité des navigateurs, pour moins se distinguer. Les sites peuvent alors s'afficher en anglais."
>
  <Toggle
    label="Uniformiser la langue envoyée aux sites"
    checked={s.privacy.normalizeAcceptLanguage}
    onchange={(normalizeAcceptLanguage) => update({ privacy: { normalizeAcceptLanguage } })}
  />
</Row>
<DrmRow />
<Row
  anchor="weather"
  label="Widget Météo"
  hint="Absent par défaut. Une fois ajouté, il envoie à Open-Meteo les coordonnées de la ville choisie (sans clé, sans cookie, réponses gardées 30 min) : rien d'autre ne quitte l'appareil."
  keywords="open-meteo localisation réseau page d'accueil"
>
  <span class="note">Réglé depuis la page d'accueil</span>
</Row>
<Row label="Mots de passe" hint="Identifiants enregistrés, chiffrés sur cet appareil." keywords="identifiants comptes connexion">
  <Button icon="key" onclick={() => api.commands.run("open-passwords")}>Gérer les mots de passe</Button>
</Row>

<style>
  .note {
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
