<script lang="ts">
  import { t } from "@shared/i18n";
  import { settings } from "../../lib/settings.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /** "Notifications" (ADR-041): do not disturb, and where the per-site choices live. */
  const n = $derived(settings.current.notifications);
</script>

<Row anchor="do-not-disturb" label={t("notificationsSection.doNotDisturb")} hint={t("notificationsSection.siteNotificationsNoLonger")} keywords={t("notificationsSection.silenceMuteNotificationsAlerts")}>
  <Toggle label={t("notificationsSection.doNotDisturb")} checked={n.doNotDisturb} onchange={(doNotDisturb) => settings.update({ notifications: { doNotDisturb } })} />
</Row>
<Row
  anchor="per-site"
  label={t("notificationsSection.permissionsPerSite")}
  hint={t("notificationsSection.siteFirstAsksPermission")}
  keywords={t("notificationsSection.permissionAllowBlockSite")}
>
  <span class="note">{t("notificationsSection.siteInfo")}</span>
</Row>
<Row
  anchor="push"
  label={t("notificationsSection.backgroundNotifications")}
  hint={t("notificationsSection.pushNotificationsSentWhen")}
  keywords={t("notificationsSection.webPushServiceWorker")}
>
  <span class="note">{t("notificationsSection.notSupported")}</span>
</Row>

<style>
  .note {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
</style>
