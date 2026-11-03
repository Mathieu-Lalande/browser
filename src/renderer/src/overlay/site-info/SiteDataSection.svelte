<script lang="ts">
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

  const allowThirdParty = async (allow: boolean) => apply(await api.siteInfo.allowThirdPartyCookies(tabId, allow).catch(() => null));
</script>

<section class="kit-section" aria-labelledby="site-cookies">
  <div class="kit-line">
    <Icon name="cookie" size={14} />
    <span class="kit-label" id="site-cookies">Cookies et données du site</span>
    <span class="kit-value" data-testid="cookie-count">{cookieCount(info.cookies)}</span>
  </div>
  <div class="kit-actions">
    {#if cleared}<span class="done"><Icon name="check" size={12} /> Données effacées</span>{/if}
    <ConfirmButton variant="outlined" question="Effacer et recharger ?" confirmLabel="Effacer" onconfirm={clearData}>
      <Icon name="trash" size={12} /> Effacer les cookies et données du site
    </ConfirmButton>
  </div>
  {#if info.thirdPartyCookies.blocking}
    <div class="kit-line">
      <span class="kit-label">Autoriser les cookies tiers sur ce site</span>
      {#if info.isPrivate}
        <span class="kit-value">{info.thirdPartyCookies.allowedHere ? "Autorisés" : "Bloqués"}</span>
      {:else}
        <Toggle label="Autoriser les cookies tiers sur ce site" checked={info.thirdPartyCookies.allowedHere} onchange={allowThirdParty} />
      {/if}
    </div>
  {/if}
</section>

<section class="kit-section" aria-labelledby="site-permissions">
  <div class="kit-line"><Icon name="key" size={14} /><span class="kit-label" id="site-permissions">Autorisations</span></div>
  {#if info.permissions.length}
    <ul class="kit-list">
      {#each info.permissions as permission (`${permission.origin} ${permission.kind}`)}
        <li>
          <span class="kit-text">
            <span>{PERMISSION_LABELS[permission.kind]}</span>
            <span class="kit-hint">
              {permission.decision === "allow" ? "Autorisé" : "Bloqué"}{permission.remembered ? "" : " jusqu'à la fermeture"}{permission.origin !== info.origin ? ` · ${permission.origin}` : ""}
            </span>
          </span>
          <Button
            variant="quiet"
            size="sm"
            onclick={() => resetPermission(permission)}
            aria-label="Réinitialiser : {PERMISSION_LABELS[permission.kind]}"
            title="Le site demandera de nouveau"
          >
            <Icon name="reset" size={12} /> Réinitialiser
          </Button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="kit-hint">Aucune autorisation accordée ni refusée à ce site.</p>
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
