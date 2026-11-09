<script lang="ts">
  import type { AutoplayPolicy, SettingsPatch } from "@shared/settings";
  import { isSiteName } from "@shared/site-info";
  import { filterSiteSettings, type SiteListSetting, type SiteSettingsEntry } from "@shared/site-settings";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Page from "../ui/Page.svelte";
  import Row from "../ui/Row.svelte";
  import SearchField from "../ui/SearchField.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import SiteSettingsCard from "./SiteSettingsCard.svelte";

  /**
   * `browser://site-settings` (ADR-046): the default behaviours, then every per-site decision of
   * the profile in one place (permissions, zoom, shields, JavaScript, sound, cookie banners,
   * third-party cookies), searchable, each removable. A private window only looks.
   */

  let entries = $state<SiteSettingsEntry[]>([]);
  let query = $state("");
  let newSite = $state("");
  /** Sites added by hand that have no setting yet (shown until the page closes). */
  let added = $state<string[]>([]);

  const s = $derived(settings.current);
  const readonly = $derived(browser.isPrivate);
  const update = (patch: SettingsPatch) => settings.update(patch);

  async function refresh(): Promise<void> {
    entries = await api.siteSettings.list().catch(() => entries);
  }
  $effect(() => {
    void refresh();
  });

  /** Applies a change and shows the list main answers (null: refused, private window). */
  async function apply(change: Promise<SiteSettingsEntry[] | null>): Promise<void> {
    const next = await change.catch(() => null);
    if (next) entries = next;
  }

  const blank = (site: string): SiteSettingsEntry => ({
    site,
    permissions: [],
    zoom: [],
    shieldsOff: [],
    javascript: false,
    muted: false,
    cookieBanners: false,
    thirdPartyCookies: false,
  });

  const shown = $derived(
    filterSiteSettings(
      [...entries, ...added.filter((site) => !entries.some((entry) => entry.site === site)).map(blank)].sort((a, b) => a.site.localeCompare(b.site)),
      query,
    ),
  );

  const candidate = $derived(newSite.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, ""));
  function addSite(event: SubmitEvent): void {
    event.preventDefault();
    if (!isSiteName(candidate)) return;
    if (!added.includes(candidate)) added = [...added, candidate];
    newSite = "";
  }

  const AUTOPLAY: { value: AutoplayPolicy; label: string }[] = [
    { value: "allow", label: "Autoriser" },
    { value: "block-sound", label: "Sans le son" },
    { value: "block-all", label: "Bloquer" },
  ];
</script>

<Page
  icon="sliders"
  title="Paramètres des sites"
  subtitle="Les décisions prises site par site, au même endroit : autorisations, zoom, protections, JavaScript, son, bandeaux cookies. Un site réinitialisé repart des réglages par défaut."
  testid="site-settings-page"
>
  {#snippet actions()}
    <Button icon="shield-check" onclick={() => api.commands.run("open-privacy-dashboard")}>Confidentialité</Button>
  {/snippet}

  <section class="section" aria-labelledby="site-defaults">
    <h2 class="heading" id="site-defaults">Par défaut</h2>
    <Row label="Lecture automatique" hint="Pour les nouveaux onglets. « Sans le son » laisse démarrer les vidéos muettes ; « Bloquer » attend un geste sur la page.">
      <Segmented label="Lecture automatique" value={s.privacy.autoplay} options={AUTOPLAY} onchange={(autoplay) => update({ privacy: { autoplay } })} />
    </Row>
    <Row label="Refuser les bandeaux cookies" hint="Clique sur « Tout refuser » (ou masque le bandeau) sur les plateformes de consentement connues.">
      <Toggle label="Refuser les bandeaux cookies" checked={s.privacy.cookieBanners} onchange={(cookieBanners) => update({ privacy: { cookieBanners } })} />
    </Row>
  </section>

  <section class="section" aria-labelledby="site-list">
    <h2 class="heading" id="site-list">Sites</h2>
    <div class="tools">
      <SearchField bind:value={query} label="Rechercher un site" />
      {#if !readonly}
        <form class="add" onsubmit={addSite}>
          <input class="ui-field" bind:value={newSite} placeholder="exemple.fr" aria-label="Ajouter un site" />
          <Button type="submit" icon="plus" disabled={!isSiteName(candidate)}>Ajouter</Button>
        </form>
      {/if}
    </div>

    {#each shown as entry (entry.site)}
      <SiteSettingsCard
        {entry}
        {readonly}
        thirdPartyBlocking={s.privacy.blockThirdPartyCookies}
        onswitch={(key: SiteListSetting, on: boolean) => apply(api.siteSettings.setSwitch(entry.site, key, on))}
        onshields={(host) => apply(api.siteSettings.setShields(host, true))}
        onzoom={(host) => apply(api.siteSettings.resetZoom(host))}
        onforget={(permission) => apply(api.siteSettings.forgetPermission(permission.origin, permission.kind, permission.topOrigin))}
        onreset={() => {
          added = added.filter((site) => site !== entry.site);
          void apply(api.siteSettings.reset(entry.site));
        }}
      />
    {:else}
      <EmptyState
        icon="globe"
        title={query ? "Aucun site trouvé" : "Aucun réglage propre à un site"}
        hint="Les autorisations accordées, le zoom choisi, les protections désactivées… apparaissent ici."
      />
    {/each}

    {#if readonly}
      <p class="hint"><Icon name="mask" size={12} /> Fenêtre privée : ces réglages se modifient depuis une fenêtre normale.</p>
    {/if}
  </section>
</Page>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .section + .section {
    margin-top: var(--space-5);
  }
  .heading {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .tools > :global(.search) {
    flex: 1 1 240px;
  }
  .add {
    display: flex;
    gap: var(--space-2);
  }
  .add input {
    width: 160px;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
</style>
