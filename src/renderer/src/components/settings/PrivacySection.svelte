<script lang="ts">
  import { t } from "@shared/i18n";
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
  label={t("privacySection.standardizeLanguageSentSites")}
  hint={t("privacySection.announcesEnUsEn")}
>
  <Toggle
    label={t("privacySection.standardizeLanguageSentSites")}
    checked={s.privacy.normalizeAcceptLanguage}
    onchange={(normalizeAcceptLanguage) => update({ privacy: { normalizeAcceptLanguage } })}
  />
</Row>
<Row
  anchor="cookie-banners"
  label={t("privacySection.refuseCookieBanners")}
  hint={t("privacySection.knownConsentPlatformsOnetrust")}
  keywords={t("privacySection.consentGdprCmp")}
>
  <Toggle label={t("privacySection.refuseCookieBanners")} checked={s.privacy.cookieBanners} onchange={(cookieBanners) => update({ privacy: { cookieBanners } })} />
</Row>
<Row
  anchor="fingerprinting"
  label={t("privacySection.fingerprintingProtection")}
  hint={s.privacy.fingerprinting === "strict"
    ? t("privacySection.strictAdditionStandardizedLanguage")
    : t("privacySection.standardBrowserPresentedGoogle")}
>
  <Segmented
    label={t("privacySection.fingerprintingProtection")}
    value={s.privacy.fingerprinting}
    options={[
      { value: "standard" as FingerprintingLevel, label: "Standard" },
      { value: "strict" as FingerprintingLevel, label: t("privacySection.strict") },
    ]}
    onchange={(fingerprinting) => update({ privacy: { fingerprinting } })}
  />
</Row>
<SecureDnsRow />
<DrmRow />
<Row
  anchor="weather"
  label={t("privacySection.weatherWidget")}
  hint={t("privacySection.absentDefaultOnceAdded")}
  keywords={t("privacySection.openMeteoLocationNetwork")}
>
  <span class="note">{t("privacySection.setFromStartPage")}</span>
</Row>
<Row label={t("privacySection.passwords")} hint={t("privacySection.savedCredentialsEncryptedDevice")} keywords={t("privacySection.credentialsAccountsSignLogin")}>
  <Button icon="key" onclick={() => api.commands.run("open-passwords")}>{t("privacySection.managePasswords")}</Button>
</Row>
<Row
  anchor="privacy-pages"
  label={t("privacySection.dashboardSiteSettings")}
  hint={t("privacySection.whatProtectionsBlockedOver")}
>
  <div class="links">
    <Button icon="shield-check" onclick={() => api.commands.run("open-privacy-dashboard")}>{t("privacySection.dashboard")}</Button>
    <Button icon="sliders" onclick={() => api.commands.run("open-site-settings")}>{t("privacySection.siteSettings")}</Button>
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
