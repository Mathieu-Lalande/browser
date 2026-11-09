<script lang="ts">
  import type { SiteInfo } from "@shared/site-info";
  import type { CommandId } from "@shared/commands";
  import type { TabId } from "@shared/types";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../../components/Icon.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Toggle from "../../components/ui/Toggle.svelte";

  /**
   * Cookie banners on this site, and the way to the privacy dashboard and the site settings
   * (ADR-046). The switch is a settings change: a private window only shows it.
   */
  let { info, tabId, onUpdate, onClose }: { info: SiteInfo; tabId: TabId; onUpdate: (next: SiteInfo) => void; onClose: (restoreFocus: boolean) => void } =
    $props();

  const setBanners = (enabled: boolean) => api.siteInfo.setCookieBanners(tabId, enabled).then((next) => next && onUpdate(next), () => {});
  const open = (command: CommandId) => {
    api.commands.run(command);
    onClose(false);
  };
</script>

{#if info.cookieBanners.enabled}
  <section class="kit-section" aria-labelledby="site-banners">
    <div class="kit-line">
      <Icon name="cookie" size={14} />
      <span class="kit-label" id="site-banners">Bandeaux cookies</span>
      <span class="kit-value">{info.cookieBanners.here ? "Refusés" : "Laissés"}</span>
      <Toggle label="Refuser les bandeaux cookies sur ce site" checked={info.cookieBanners.here} onchange={(on) => !info.isPrivate && setBanners(on)} />
    </div>
  </section>
{/if}

<section class="kit-section">
  <div class="kit-actions">
    <Button variant="quiet" size="sm" onclick={() => open("open-privacy-dashboard")}><Icon name="shield-check" size={12} /> Tableau de bord</Button>
    <Button variant="quiet" size="sm" onclick={() => open("open-site-settings")}><Icon name="sliders" size={12} /> Paramètres des sites</Button>
  </div>
</section>
