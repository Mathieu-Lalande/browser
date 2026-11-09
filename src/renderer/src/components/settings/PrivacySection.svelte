<script lang="ts">
  import type { SettingsPatch } from "@shared/settings";
  import { api } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Button from "../ui/Button.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import type { FingerprintingLevel } from "@shared/settings";
  import DrmRow from "./DrmRow.svelte";
  import SecureDnsRow from "./SecureDnsRow.svelte";

  /**
   * Settings > Confidentialité: cookie banners, fingerprinting, secure DNS (ADR-046), language sent
   * to sites, DRM, weather widget note, passwords, and the privacy pages.
   */

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
<Row
  anchor="cookie-banners"
  label="Refuser les bandeaux cookies"
  hint="Sur les plateformes de consentement connues (OneTrust, Didomi, Cookiebot…), clique sur « Tout refuser » ou « Continuer sans accepter », sinon masque le bandeau. Jamais « Accepter ». Désactivable site par site depuis les infos sur le site."
  keywords="consentement rgpd gdpr cmp"
>
  <Toggle label="Refuser les bandeaux cookies" checked={s.privacy.cookieBanners} onchange={(cookieBanners) => update({ privacy: { cookieBanners } })} />
</Row>
<Row
  anchor="fingerprinting"
  label="Protection contre le pistage par empreinte"
  hint={s.privacy.fingerprinting === "strict"
    ? "Strict : en plus, langue uniformisée, aucun indice client détaillé (version exacte, processeur, modèle), polices, écrans et appareils MIDI refusés sans demander. Le dessin (canvas, WebGL) n'est pas brouillé."
    : "Standard : navigateur présenté comme Google Chrome, version réduite, adresses IP locales masquées à WebRTC."}
>
  <Segmented
    label="Protection contre le pistage par empreinte"
    value={s.privacy.fingerprinting}
    options={[
      { value: "standard" as FingerprintingLevel, label: "Standard" },
      { value: "strict" as FingerprintingLevel, label: "Stricte" },
    ]}
    onchange={(fingerprinting) => update({ privacy: { fingerprinting } })}
  />
</Row>
<SecureDnsRow />
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
<Row
  anchor="privacy-pages"
  label="Tableau de bord et paramètres des sites"
  hint="Ce que les protections ont bloqué ces 30 derniers jours, et toutes les décisions prises site par site (autorisations, JavaScript, son, lecture automatique)."
>
  <div class="links">
    <Button icon="shield-check" onclick={() => api.commands.run("open-privacy-dashboard")}>Tableau de bord</Button>
    <Button icon="sliders" onclick={() => api.commands.run("open-site-settings")}>Paramètres des sites</Button>
  </div>
</Row>

<style>
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .note {
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
