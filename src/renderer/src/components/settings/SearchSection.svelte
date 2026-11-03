<script lang="ts">
  import type { SettingsPatch } from "@shared/settings";
  import { SEARCH_ENGINES } from "@shared/url";
  import { settings } from "../../lib/settings.svelte";
  import Row from "../ui/Row.svelte";

  /** Settings > Recherche: the search engine. */

  const s = $derived(settings.current);
  const update = (patch: SettingsPatch) => settings.update(patch);
</script>

<Row anchor="engine" label="Moteur de recherche" hint="Utilisé quand le texte saisi n'est pas une adresse." keywords="google duckduckgo bing qwant ecosia" stacked>
<div class="engines" role="radiogroup" aria-label="Moteur de recherche">
  {#each SEARCH_ENGINES as engine (engine.id)}
    <button
      class="engine"
      role="radio"
      aria-checked={s.search.engine === engine.id}
      onclick={() => update({ search: { engine: engine.id } })}
    >
      <span class="radio"></span>
      <span class="engine-name">{engine.name}</span>
      <span class="engine-host">{new URL(engine.template).hostname.replace(/^www\./, "")}</span>
    </button>
  {/each}
</div>
</Row>

<style>
  .engines {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: var(--space-2);
  }
  .engine {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: var(--space-3);
    padding: 10px var(--space-3);
    border-radius: var(--radius-md);
    text-align: left;
    box-shadow: inset 0 0 0 1px var(--border);
    transition:
      background var(--motion-fast) var(--ease),
      box-shadow var(--motion-fast) var(--ease);
  }
  .engine:hover {
    background: var(--surface-hover);
  }
  .engine[aria-checked="true"] {
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent-text);
  }
  .radio {
    grid-row: span 2;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--text-faint);
  }
  .engine[aria-checked="true"] .radio {
    background: #fff;
    box-shadow: inset 0 0 0 5px var(--accent-text);
  }
  .engine-name {
    font-weight: 500;
  }
  .engine-host {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>
