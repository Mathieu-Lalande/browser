<script lang="ts">
  import { t } from "@shared/i18n";
  import { PERMISSION_LABELS, cookieCount, type SiteInfo, type SitePermission } from "@shared/site-info";
  import type { TabId } from "@shared/types";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../../components/Icon.svelte";
  import Button from "../../components/ui/Button.svelte";
  import ConfirmButton from "../../components/ui/ConfirmButton.svelte";
  import Toggle from "../../components/ui/Toggle.svelte";

  /**
   * What the site keeps and may do (ADR-021): cookies and site data, third-party cookies, and the
   * permissions granted or refused. Main answers each change with the new site info.
   */
  let { info, tabId, onUpdate }: { info: SiteInfo; tabId: TabId; onUpdate: (next: SiteInfo) => void } = $props();

  let cleared = $state(false);

  const apply = (next: SiteInfo | null) => next && onUpdate(next);

  async function clearData(): Promise<void> {
    apply(await api.siteInfo.clearData(tabId).catch(() => null));
    cleared = true;
  }

  const resetPermission = async (permission: SitePermission) =>
    apply(await api.siteInfo.resetPermission(tabId, permission.origin, permission.kind).catch(() => null));

  /** Allow ⇄ block, from the popover (ADR-041): the site then neither asks nor gets it. */
  const flipPermission = async (permission: SitePermission) =>
    apply(await api.siteInfo.setPermission(tabId, permission.origin, permission.kind, permission.decision !== "allow").catch(() => null));
  const allowThirdParty = async (allow: boolean) => apply(await api.siteInfo.allowThirdPartyCookies(tabId, allow).catch(() => null));
</script>

<section class="kit-section" aria-labelledby="site-cookies">
  <div class="kit-line">
    <Icon name="cookie" size={14} />
    <span class="kit-label" id="site-cookies">{t("siteDataSection.siteCookiesData")}</span>
    <span class="kit-value" data-testid="cookie-count">{cookieCount(info.cookies)}</span>
  </div>
  <div class="kit-actions">
    {#if cleared}<span class="done"><Icon name="check" size={12} /> {t("siteDataSection.dataCleared")}</span>{/if}
    <ConfirmButton variant="outlined" question={t("siteDataSection.clearReload")} confirmLabel={t("siteDataSection.clear")} onconfirm={clearData}>
      <Icon name="trash" size={12} /> {t("siteDataSection.clearSitesCookiesData")}
    </ConfirmButton>
  </div>
  {#if info.thirdPartyCookies.blocking}
    <div class="kit-line">
      <span class="kit-label">{t("siteDataSection.allowThirdPartyCookies")}</span>
      {#if info.isPrivate}
        <span class="kit-value">{info.thirdPartyCookies.allowedHere ? t("siteDataSection.allowed") : t("siteDataSection.blocked")}</span>
      {:else}
        <Toggle label={t("siteDataSection.allowThirdPartyCookies")} checked={info.thirdPartyCookies.allowedHere} onchange={allowThirdParty} />
      {/if}
    </div>
  {/if}
</section>

<section class="kit-section" aria-labelledby="site-permissions">
  <div class="kit-line"><Icon name="key" size={14} /><span class="kit-label" id="site-permissions">{t("siteDataSection.permissions")}</span></div>
  {#if info.permissions.length}
    <ul class="kit-list">
      {#each info.permissions as permission (`${permission.origin} ${permission.kind}`)}
        <li>
          <span class="kit-text">
            <span>{PERMISSION_LABELS[permission.kind]}</span>
            <span class="kit-hint">
              {permission.decision === "allow" ? t("siteDataSection.allowed2") : t("siteDataSection.blocked2")}{permission.remembered ? "" : t("siteDataSection.untilClosing")}{permission.origin !== info.origin ? ` · ${permission.origin}` : ""}
            </span>
          </span>
          <Button
            variant="quiet"
            size="sm"
            onclick={() => flipPermission(permission)}
            aria-label="{permission.decision === 'allow' ? t("siteDataSection.block") : t("siteDataSection.allow")} : {PERMISSION_LABELS[permission.kind]}"
          >
            {permission.decision === "allow" ? t("siteDataSection.block") : t("siteDataSection.allow")}
          </Button>
          <Button
            variant="quiet"
            size="sm"
            onclick={() => resetPermission(permission)}
            aria-label={t("siteDataSection.reset", { p: PERMISSION_LABELS[permission.kind] })}
            title={t("siteDataSection.siteWillAskAgain")}
          >
            <Icon name="reset" size={12} /> {t("siteDataSection.reset2")}
          </Button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="kit-hint">{t("siteDataSection.noPermissionGrantedRefused")}</p>
  {/if}
</section>

<style>
  .done {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>
