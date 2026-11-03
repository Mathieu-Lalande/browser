<script lang="ts">
  import type { TabState } from "@shared/types";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../../components/Icon.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Toggle from "../../components/ui/Toggle.svelte";

  /** The tab's shields and zoom, following its live state (the page reloads, the zoom changes…). */
  let { tab, defaultZoom }: { tab: TabState; defaultZoom: number } = $props();
</script>

<section class="kit-section" aria-labelledby="site-shields">
  <div class="kit-line">
    <Icon name={tab.shieldsEnabled ? "shield" : "shield-off"} size={14} />
    <span class="kit-label" id="site-shields">Protections</span>
    <span class="kit-value">{tab.shieldsEnabled ? `${tab.blockedCount} bloqué${tab.blockedCount > 1 ? "s" : ""}` : "Désactivées"}</span>
    <Toggle label="Protections sur ce site" checked={tab.shieldsEnabled} onchange={() => api.tabs.toggleShields(tab.id)} />
  </div>
</section>

<section class="kit-section" aria-labelledby="site-zoom">
  <div class="kit-line">
    <Icon name="zoom-in" size={14} />
    <span class="kit-label" id="site-zoom">Zoom</span>
    <span class="kit-value">{tab.zoom}&#8239;%</span>
    <Button variant="quiet" size="sm" disabled={tab.zoom === defaultZoom} onclick={() => api.commands.run("zoom-reset")}>
      <Icon name="reset" size={12} /> {defaultZoom}&#8239;%
    </Button>
  </div>
</section>
