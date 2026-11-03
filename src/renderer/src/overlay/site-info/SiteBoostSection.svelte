<script lang="ts">
  import { BOOST_FONTS, type Boost, type BoostFont } from "@shared/boosts";
  import type { TabBoost, TabId } from "@shared/types";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../../components/Icon.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Toggle from "../../components/ui/Toggle.svelte";

  /**
   * The boost of the tab's site (ADR-029): quick toggles here, the full editor in browser://boosts.
   * A private window only shows it.
   */
  let { tabId, onClose }: { tabId: TabId; onClose: (restoreFocus: boolean) => void } = $props();

  const QUICK_FILTERS = [
    { key: "invert", label: "Inverser" },
    { key: "grayscale", label: "Gris" },
    { key: "sepia", label: "Sépia" },
  ] as const;
  type QuickFilter = (typeof QUICK_FILTERS)[number]["key"];

  let tabBoost = $state<TabBoost | null>(null);
  const refresh = () => api.boosts.forTab(tabId).then((next) => (tabBoost = next), () => {});
  $effect(() => {
    void refresh();
    return api.boosts.onChanged(() => void refresh());
  });

  const create = () => api.boosts.createForTab(tabId).then((next) => (tabBoost = next), () => {});
  const unzap = (selector: string) => api.boosts.unzap(tabId, selector).then((next) => (tabBoost = next), () => {});

  function update(change: (boost: Boost) => Boost): void {
    const boost = tabBoost?.boost;
    if (boost) void api.boosts.save(change($state.snapshot(boost))).then(() => refresh(), () => {});
  }

  const filterOn = (boost: Boost, key: QuickFilter) => (key === "invert" ? boost.filters.invert : boost.filters[key] > 0);
  const toggleFilter = (key: QuickFilter) =>
    update((boost) => ({
      ...boost,
      filters: key === "invert" ? { ...boost.filters, invert: !boost.filters.invert } : { ...boost.filters, [key]: boost.filters[key] > 0 ? 0 : 100 },
    }));
</script>

{#if tabBoost}
  {@const boost = tabBoost.boost}
  <section class="kit-section" aria-labelledby="site-boost" data-testid="site-boost">
    <div class="kit-line">
      <Icon name="rocket" size={14} />
      <span class="kit-label" id="site-boost">Boost</span>
      {#if boost && !tabBoost.isPrivate}
        <Toggle label="Boost actif sur ce site" checked={boost.enabled} onchange={(enabled) => update((b) => ({ ...b, enabled }))} />
      {:else if boost}
        <span class="kit-value">{boost.enabled ? "Actif" : "Désactivé"}</span>
      {/if}
    </div>
    {#if !boost}
      {#if !tabBoost.isPrivate}
        <div class="kit-actions">
          <Button variant="quiet" size="sm" onclick={create}><Icon name="plus" size={12} /> Personnaliser ce site</Button>
        </div>
      {:else}
        <p class="kit-hint">Aucun boost pour ce site.</p>
      {/if}
    {:else if !tabBoost.isPrivate}
      <div class="chips" role="group" aria-label="Filtres de couleur">
        {#each QUICK_FILTERS as filter (filter.key)}
          <button class="chip" aria-pressed={filterOn(boost, filter.key)} onclick={() => toggleFilter(filter.key)}>{filter.label}</button>
        {/each}
        <select
          class="chip"
          aria-label="Police"
          value={boost.font ?? ""}
          onchange={(event) => {
            const font = (event.currentTarget.value || null) as BoostFont | null;
            update((b) => ({ ...b, font }));
          }}
        >
          <option value="">Police du site</option>
          {#each Object.entries(BOOST_FONTS) as [id, font] (id)}<option value={id}>{font.label}</option>{/each}
        </select>
      </div>
      {#if boost.zaps.length}
        <ul class="kit-list" aria-label="Éléments masqués">
          {#each boost.zaps as selector (selector)}
            <li>
              <span class="kit-text"><code class="kit-code">{selector}</code></span>
              <Button variant="quiet" size="sm" onclick={() => unzap(selector)} title="Afficher de nouveau cet élément"><Icon name="undo" size={12} /> Réafficher</Button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="kit-actions">
        <Button variant="quiet" size="sm" onclick={() => api.boosts.zap(tabId)} disabled={tabBoost.zapping}>
          <Icon name="eraser" size={12} /> Masquer des éléments
        </Button>
        <Button variant="quiet" size="sm" onclick={() => (onClose(false), api.commands.run("open-boosts"))}><Icon name="pencil" size={12} /> Modifier</Button>
      </div>
    {/if}
  </section>
{/if}

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-xs);
  }
  .chip[aria-pressed="true"] {
    border-color: transparent;
    background: color-mix(in oklab, var(--accent) 18%, transparent);
    color: var(--accent-text);
  }
</style>
