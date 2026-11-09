<script lang="ts">
  import { t } from "@shared/i18n";
  import { PERMISSION_LABELS } from "@shared/site-info";
  import type { SiteListSetting, SiteSettingsEntry } from "@shared/site-settings";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /** One site of `browser://site-settings` (ADR-046): its switches, then each remembered decision. */
  let {
    entry,
    readonly,
    thirdPartyBlocking,
    onswitch,
    onshields,
    onzoom,
    onforget,
    onreset,
  }: {
    entry: SiteSettingsEntry;
    readonly: boolean;
    /** "Bloquer les cookies tiers" is on: the exception switch means something. */
    thirdPartyBlocking: boolean;
    onswitch: (key: SiteListSetting, on: boolean) => void;
    onshields: (host: string) => void;
    onzoom: (host: string) => void;
    onforget: (permission: SiteSettingsEntry["permissions"][number]) => void;
    onreset: () => void;
  } = $props();

  const permissionOrigin = (origin: string) => origin.replace(/^https?:\/\//, "");
</script>

<article class="site" data-site={entry.site} aria-label={entry.site}>
  <header>
    <Icon name="globe" size={16} />
    <h3>{entry.site}</h3>
    {#if !readonly}
      <ConfirmButton question={t("siteSettingsCard.forgetAllSettings", { site: entry.site })} confirmLabel={t("siteSettingsCard.reset")} onconfirm={onreset}>
        <Icon name="reset" size={14} /> {t("siteSettingsCard.reset")}
      </ConfirmButton>
    {/if}
  </header>

  <ul class="lines">
    <li>
      <Icon name="code" size={14} />
      <span class="label">JavaScript</span>
      <Toggle label={t("siteSettingsCard.javascript", { site: entry.site })} checked={!entry.javascript} onchange={(on) => !readonly && onswitch("javascript", !on)} />
    </li>
    <li>
      <Icon name="volume-off" size={14} />
      <span class="label">{t("siteSettingsCard.mute")}</span>
      <Toggle label={t("siteSettingsCard.mute2", { site: entry.site })} checked={entry.muted} onchange={(on) => !readonly && onswitch("muted", on)} />
    </li>
    <li>
      <Icon name="cookie" size={14} />
      <span class="label">{t("siteSettingsCard.refuseCookieBanners")}</span>
      <Toggle label={t("siteSettingsCard.refuseCookieBanners2", { site: entry.site })} checked={!entry.cookieBanners} onchange={(on) => !readonly && onswitch("cookieBanners", !on)} />
    </li>
    {#if thirdPartyBlocking || entry.thirdPartyCookies}
      <li>
        <Icon name="globe-off" size={14} />
        <span class="label">{t("siteSettingsCard.allowThirdPartyCookies")}</span>
        <Toggle label={t("siteSettingsCard.allowThirdPartyCookies2", { site: entry.site })} checked={entry.thirdPartyCookies} onchange={(on) => !readonly && onswitch("thirdPartyCookies", on)} />
      </li>
    {/if}
    {#each entry.shieldsOff as host (host)}
      <li>
        <Icon name="shield-off" size={14} />
        <span class="label">{t("siteSettingsCard.protectionsTurnedOff")} <span class="detail">{host}</span></span>
        {#if !readonly}<Button size="sm" variant="quiet" onclick={() => onshields(host)}>{t("siteSettingsCard.turnBack")}</Button>{/if}
      </li>
    {/each}
    {#each entry.zoom as zoom (zoom.host)}
      <li>
        <Icon name="zoom-in" size={14} />
        <span class="label">{t("siteSettingsCard.zoom", { zoom: zoom.zoom })} <span class="detail">{zoom.host}</span></span>
        {#if !readonly}<Button size="sm" variant="quiet" onclick={() => onzoom(zoom.host)}>{t("siteSettingsCard.default")}</Button>{/if}
      </li>
    {/each}
    {#each entry.permissions as permission (`${permission.origin} ${permission.topOrigin} ${permission.kind}`)}
      <li>
        <Icon name={permission.decision === "allow" ? "check" : "close"} size={14} />
        <span class="label">
          {PERMISSION_LABELS[permission.kind]} : {permission.decision === "allow" ? t("siteSettingsCard.allowed") : t("siteSettingsCard.blocked")}
          {#if permission.origin !== permission.topOrigin}<span class="detail">{permissionOrigin(permission.origin)}</span>{/if}
        </span>
        {#if !readonly}<Button size="sm" variant="quiet" onclick={() => onforget(permission)}>{t("siteSettingsCard.forget")}</Button>{/if}
      </li>
    {/each}
  </ul>
</article>

<style>
  .site {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
  }
  h3 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--text);
    font-size: var(--text-md);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--hit-min);
    color: var(--text-muted);
  }
  .label {
    flex: 1;
    min-width: 0;
    color: var(--text);
    font-size: var(--text-sm);
  }
  .detail {
    margin-left: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
</style>
