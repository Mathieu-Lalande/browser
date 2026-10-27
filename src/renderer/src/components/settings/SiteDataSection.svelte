<script lang="ts">
  import { cookieCount, filterSites, type SiteDataEntry } from "@shared/site-info";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import ConfirmButton from "./ConfirmButton.svelte";
  import Row from "./Row.svelte";
  import Toggle from "./Toggle.svelte";

  /**
   * Cookies and site data of the profile (default session and isolated spaces), grouped by site,
   * and third-party cookie blocking (ADR-021). A private window never lists nor clears them.
   */
  let sites = $state<SiteDataEntry[] | null>(null);
  let loaded = $state(false);
  let query = $state("");
  let cleared = $state(false);

  const shown = $derived(sites ? filterSites(sites, query) : []);
  const total = $derived(sites?.reduce((sum, entry) => sum + entry.cookies, 0) ?? 0);
  const privacy = $derived(settings.current.privacy);

  const refresh = () =>
    api.siteData.list().then(
      (list) => ((sites = list), (loaded = true)),
      () => (loaded = true),
    );

  $effect(() => {
    void refresh();
  });

  async function remove(site: string): Promise<void> {
    sites = (await api.siteData.remove(site).catch(() => sites)) ?? sites;
  }

  async function clearAll(): Promise<void> {
    sites = (await api.siteData.clearAll().catch(() => sites)) ?? sites;
    cleared = true;
  }

  function removeException(site: string): void {
    void settings.update({ privacy: { thirdPartyCookieExceptions: privacy.thirdPartyCookieExceptions.filter((item) => item !== site) } });
  }
</script>

<Row
  label="Bloquer les cookies tiers"
  hint="Les cookies ne sont ni envoyés ni enregistrés pour les requêtes vers d'autres sites que celui affiché (pisteurs, publicités). Peut empêcher certaines connexions ou contenus intégrés : ajoutez une exception depuis les infos du site (cadenas)."
>
  <Toggle
    label="Bloquer les cookies tiers"
    checked={privacy.blockThirdPartyCookies}
    onchange={(blockThirdPartyCookies) => settings.update({ privacy: { blockThirdPartyCookies } })}
  />
</Row>

{#if privacy.thirdPartyCookieExceptions.length}
  <Row label="Exceptions" hint="Sites où les cookies tiers restent autorisés." stacked>
    <ul class="list compact" aria-label="Exceptions aux cookies tiers">
      {#each privacy.thirdPartyCookieExceptions as site (site)}
        <li>
          <span class="site">{site}</span>
          <button class="remove" aria-label="Retirer l'exception pour {site}" title="Retirer l'exception" onclick={() => removeException(site)}>
            <Icon name="close" size={12} />
          </button>
        </li>
      {/each}
    </ul>
  </Row>
{/if}

{#if browser.isPrivate}
  <Row label="Cookies et données des sites" hint="Indisponible en navigation privée : cette fenêtre ne garde rien, et ne touche pas aux données du profil.">
    <span></span>
  </Row>
{:else}
  <Row
    label="Cookies et données des sites"
    hint={sites?.length ? `${sites.length} site${sites.length > 1 ? "s" : ""}, ${cookieCount(total)} (espaces isolés compris).` : loaded ? "Aucun site n'a enregistré de cookies." : "Chargement…"}
    stacked={!!sites?.length}
  >
    {#if cleared && !sites?.length}<span class="done"><Icon name="check" size={12} /> Données effacées</span>{/if}
    {#if sites?.length}
      <div class="sites">
      <div class="tools">
        <label class="search">
          <Icon name="search" size={12} />
          <input type="search" placeholder="Rechercher un site" aria-label="Rechercher un site" bind:value={query} spellcheck="false" />
        </label>
        <ConfirmButton variant="outlined" question="Tous les sites ?" confirmLabel="Tout effacer" onconfirm={clearAll}>
          <Icon name="trash" size={12} /> Tout effacer
        </ConfirmButton>
      </div>
      <ul class="list" aria-label="Sites avec des cookies">
        {#each shown as entry (entry.site)}
          <li>
            <Icon name="cookie" size={14} />
            <span class="site">{entry.site}</span>
            <span class="count">{cookieCount(entry.cookies)}</span>
            <button class="remove" aria-label="Effacer les données de {entry.site}" title="Effacer les cookies et données de ce site" onclick={() => remove(entry.site)}>
              <Icon name="trash" size={12} />
            </button>
          </li>
        {:else}
          <li class="none">Aucun site ne correspond.</li>
        {/each}
      </ul>
      </div>
    {/if}
  </Row>
{/if}

<style>
  button:focus-visible {
    outline-offset: -2px;
  }
  .done {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .sites {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .search {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    min-width: 160px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-faint);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    max-height: 300px;
    margin: 0;
    padding: 4px;
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
    color: var(--text-muted);
  }
  .list.compact {
    max-height: 180px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 2px 6px 2px 10px;
    border-radius: 7px;
  }
  li:hover {
    background: var(--surface-hover);
  }
  li.none {
    color: var(--text-faint);
  }
  .site {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .count {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .remove {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    color: var(--text-faint);
  }
  .remove:hover {
    background: var(--surface-active);
    color: var(--text);
  }
</style>
