<script lang="ts">
  import type { WeatherPlace } from "@shared/start-widgets";
  import { MAX_PLACE_QUERY, WEATHER_CACHE_MS, forecastWeekday, formatTemperature, weatherCondition, type Forecast } from "@shared/weather";
  import { api } from "../../../lib/browser.svelte";
  import Icon from "../../Icon.svelte";
  import type { WidgetProps } from "../types";

  let { widget, layout }: WidgetProps<"weather"> = $props();

  const place = $derived(widget.options.place);
  let forecast = $state<Forecast | null>(null);
  let failed = $state(false);

  // Main caches answers for 30 min: refreshing on that rhythm costs one request per place.
  $effect(() => {
    const current = place;
    forecast = null;
    failed = false;
    if (!current) return;
    const load = () =>
      api.weather.forecast(current.latitude, current.longitude).then(
        (result) => ((forecast = result), (failed = !result)),
        () => (failed = true),
      );
    void load();
    const timer = setInterval(load, WEATHER_CACHE_MS);
    return () => clearInterval(timer);
  });

  // City search (no place chosen yet).
  let query = $state("");
  let results = $state<WeatherPlace[] | null>(null);
  let searching = $state(false);

  async function search(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (query.trim().length < 2) return;
    searching = true;
    results = await api.weather.places(query.trim().slice(0, MAX_PLACE_QUERY)).catch(() => []);
    searching = false;
  }

  function choose(choice: WeatherPlace): void {
    layout.setOptions(widget.id, { place: choice });
    results = null;
    query = "";
  }

  const condition = $derived(forecast ? weatherCondition(forecast.code, forecast.isDay) : null);
</script>

{#if !place}
  <h2 class="widget-title">Météo</h2>
  <form class="find" onsubmit={search}>
    <input class="ui-field" bind:value={query} placeholder="Ville" aria-label="Ville de la météo" maxlength={MAX_PLACE_QUERY} />
    <button class="go" aria-label="Chercher la ville" disabled={searching}><Icon name="search" size={14} /></button>
  </form>
  {#if results}
    {#if results.length}
      <ul class="results" aria-label="Villes trouvées">
        {#each results as result, index (index)}
          <li>
            <button onclick={() => choose(result)}><Icon name="map-pin" size={13} /> {result.name} <span>{result.region}</span></button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="widget-empty">Aucune ville trouvée (ou pas de connexion).</p>
    {/if}
  {:else}
    <p class="widget-empty">Prévisions d'Open-Meteo, sans clé ni cookie.</p>
  {/if}
{:else}
  <div class="now" title={condition?.label}>
    {#if condition && forecast}
      <Icon name={condition.icon} size={widget.size === "s" ? 30 : 36} />
      <div>
        <p class="temp">{formatTemperature(forecast.temperature, widget.options.unit)}</p>
        <p class="where">{place.name} · {condition.label}</p>
      </div>
    {:else}
      <Icon name="cloud" size={30} />
      <p class="where">{place.name} · {failed ? "Météo indisponible" : "Chargement…"}</p>
    {/if}
  </div>
  {#if widget.size !== "s" && forecast}
    <ul class="days">
      {#each forecast.days.slice(1, 4) as day (day.date)}
        <li>
          <span>{forecastWeekday(day.date)}</span>
          <Icon name={weatherCondition(day.code).icon} size={16} />
          <span class="range">{formatTemperature(day.max, widget.options.unit)} <em>{formatTemperature(day.min, widget.options.unit)}</em></span>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .find {
    display: flex;
    gap: 6px;
  }
  .find input {
    flex: 1;
    min-width: 0;
  }
  .go {
    display: grid;
    place-items: center;
    width: 30px;
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-muted);
  }
  .results {
    display: grid;
    gap: 1px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }
  .results button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 6px;
    border-radius: 8px;
    color: var(--text);
    font-size: 13px;
    text-align: left;
  }
  .results button:hover {
    background: var(--surface-hover);
  }
  .results span {
    overflow: hidden;
    color: var(--text-faint);
    font-size: 12px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .now {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--accent-text);
  }
  .now p {
    margin: 0;
  }
  .temp {
    color: var(--text);
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.03em;
  }
  .where {
    color: var(--text-muted);
    font-size: 12px;
  }
  .days {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }
  .days li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 0;
    border-radius: 10px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 12px;
  }
  .range {
    color: var(--text);
  }
  .range em {
    color: var(--text-faint);
    font-style: normal;
  }
</style>
