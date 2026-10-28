<script lang="ts">
  import {
    BOOST_FONTS,
    DEFAULT_FILTERS,
    FILTER_RANGES,
    MAX_BOOST_CSS,
    MAX_BOOST_SCRIPT,
    filtersActive,
    type Boost,
    type BoostFont,
    type BoostInput,
    type FilterAmount,
  } from "@shared/boosts";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import ConfirmButton from "../settings/ConfirmButton.svelte";
  import Slider from "../settings/Slider.svelte";
  import Toggle from "../settings/Toggle.svelte";

  /**
   * `browser://boosts` (ADR-029): every boost, to switch on/off, edit or remove. The editor sends
   * a whole boost; main validates it (pattern, sizes, selectors) and answers with a message to fix.
   * A private window only lists them.
   */

  const FILTER_LABELS: Record<FilterAmount, string> = { grayscale: "Niveaux de gris", sepia: "Sépia", brightness: "Luminosité", contrast: "Contraste" };

  let boosts = $state<Boost[]>([]);
  let loaded = $state(false);
  let draft = $state<BoostInput | null>(null);
  let error = $state<string | null>(null);
  let request = 0;

  async function refresh(): Promise<void> {
    const id = ++request;
    const list = await api.boosts.list().catch(() => []);
    if (id !== request) return;
    boosts = list;
    loaded = true;
  }

  $effect(() => {
    void refresh();
    return api.boosts.onChanged(() => void refresh());
  });

  const blank = (): BoostInput => ({
    name: "",
    match: "",
    enabled: true,
    css: "",
    zaps: [],
    font: null,
    filters: { ...DEFAULT_FILTERS },
    script: { enabled: false, code: "", allowPrivate: false },
  });

  function edit(boost: Boost | null): void {
    error = null;
    draft = boost ? structuredClone($state.snapshot(boost)) : blank();
  }

  async function save(): Promise<void> {
    if (!draft) return;
    const result = await api.boosts.save($state.snapshot(draft)).catch(() => ({ ok: false as const, message: "Le boost n'a pas été enregistré." }));
    if (result.ok) {
      draft = null;
      error = null;
    } else error = result.message;
  }

  const toggle = (boost: Boost, enabled: boolean) => api.boosts.save({ ...$state.snapshot(boost), enabled });

  function summary(boost: Boost): string {
    const parts: string[] = [];
    if (filtersActive(boost.filters)) parts.push("filtres");
    if (boost.font) parts.push(BOOST_FONTS[boost.font].label.toLowerCase());
    if (boost.zaps.length) parts.push(`${boost.zaps.length} élément${boost.zaps.length > 1 ? "s" : ""} masqué${boost.zaps.length > 1 ? "s" : ""}`);
    if (boost.css.trim()) parts.push("CSS");
    if (boost.script.enabled) parts.push("JavaScript");
    return parts.join(" · ") || "Aucune modification";
  }
</script>

<div class="page" data-testid="boosts-page">
  <div class="inner">
    <header>
      <span class="badge"><Icon name="rocket" size={20} /></span>
      <h1>Boosts</h1>
      {#if !browser.isPrivate && !draft}
        <button class="action" onclick={() => edit(null)}><Icon name="plus" size={12} /> Nouveau boost</button>
      {/if}
    </header>

    <p class="intro">
      {#if browser.isPrivate}
        Les boosts s'appliquent aussi aux fenêtres privées (sans leur JavaScript, sauf autorisation), mais se modifient depuis une fenêtre normale.
      {:else}
        Personnalisez des sites : filtres de couleur, police, éléments masqués et CSS. Pour masquer un élément d'une page, utilisez
        « Masquer des éléments » dans la palette de commandes ou les infos sur le site.
      {/if}
    </p>

    {#if draft}
      <form class="card editor" aria-label="Modifier le boost" onsubmit={(event) => (event.preventDefault(), void save())}>
        <div class="fields">
          <label class="field">
            <span>Site</span>
            <input bind:value={draft.match} placeholder="exemple.fr ou *.exemple.fr" spellcheck="false" autocomplete="off" data-testid="boost-match" />
          </label>
          <label class="field">
            <span>Nom</span>
            <input bind:value={draft.name} placeholder="Facultatif" maxlength="80" />
          </label>
        </div>

        <fieldset>
          <legend>Couleurs</legend>
          <div class="line">
            <span class="label">Inverser les couleurs</span>
            <Toggle label="Inverser les couleurs" checked={draft.filters.invert} onchange={(value) => draft && (draft.filters.invert = value)} />
          </div>
          {#each Object.keys(FILTER_LABELS) as FilterAmount[] as key (key)}
            <div class="line">
              <span class="label">{FILTER_LABELS[key]}</span>
              <Slider
                label={FILTER_LABELS[key]}
                value={draft.filters[key]}
                min={FILTER_RANGES[key].min}
                max={FILTER_RANGES[key].max}
                unit="%"
                onchange={(value) => draft && (draft.filters[key] = value)}
              />
            </div>
          {/each}
        </fieldset>

        <fieldset>
          <legend>Police</legend>
          <select
            aria-label="Police"
            value={draft.font ?? ""}
            onchange={(event) => draft && (draft.font = (event.currentTarget.value || null) as BoostFont | null)}
          >
            <option value="">Police du site</option>
            {#each Object.entries(BOOST_FONTS) as [id, font] (id)}<option value={id}>{font.label}</option>{/each}
          </select>
        </fieldset>

        <fieldset>
          <legend>Éléments masqués</legend>
          {#if draft.zaps.length}
            <ul class="zaps">
              {#each draft.zaps as selector (selector)}
                <li>
                  <code>{selector}</code>
                  <button type="button" class="small" onclick={() => draft && (draft.zaps = draft.zaps.filter((item) => item !== selector))}>
                    <Icon name="undo" size={12} /> Réafficher
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="hint">Aucun. Ouvrez le site puis « Masquer des éléments ».</p>
          {/if}
        </fieldset>

        <fieldset>
          <legend>CSS personnalisé</legend>
          <textarea class="code" bind:value={draft.css} rows="8" spellcheck="false" maxlength={MAX_BOOST_CSS} placeholder={"body {\n  max-width: 900px;\n}"} aria-label="CSS personnalisé"></textarea>
        </fieldset>

        <fieldset>
          <legend>JavaScript</legend>
          <div class="line">
            <span class="label">Exécuter un script sur ce site</span>
            <Toggle label="Exécuter un script sur ce site" checked={draft.script.enabled} onchange={(value) => draft && (draft.script.enabled = value)} />
          </div>
          {#if draft.script.enabled}
            <p class="warning" role="note">
              <Icon name="warning" size={14} />
              <span>
                Un script peut lire et modifier tout ce que la page affiche, y compris ce que vous y saisissez. N'ajoutez que du code que vous
                comprenez. Il s'exécute isolé des scripts de la page, au chargement, et il est synchronisé avec vos appareils.
              </span>
            </p>
            <textarea class="code" bind:value={draft.script.code} rows="8" spellcheck="false" maxlength={MAX_BOOST_SCRIPT} aria-label="Script"></textarea>
            <div class="line">
              <span class="label">Aussi en navigation privée</span>
              <Toggle label="Exécuter aussi en navigation privée" checked={draft.script.allowPrivate} onchange={(value) => draft && (draft.script.allowPrivate = value)} />
            </div>
          {/if}
        </fieldset>

        {#if error}<p class="error" role="alert"><Icon name="warning" size={14} /> {error}</p>{/if}
        <div class="buttons">
          <button type="button" class="action" onclick={() => ((draft = null), (error = null))}>Annuler</button>
          <button type="submit" class="action primary">Enregistrer</button>
        </div>
      </form>
    {/if}

    {#if boosts.length}
      <ul class="card">
        {#each boosts as boost (boost.id)}
          <li class="row" class:disabled={!boost.enabled} data-boost-id={boost.id}>
            <span class="icon"><Icon name="rocket" size={16} /></span>
            <span class="text">
              <span class="title">{boost.name}</span>
              <span class="detail">{boost.match} · {summary(boost)}</span>
            </span>
            {#if !browser.isPrivate}
              <Toggle label={`${boost.enabled ? "Désactiver" : "Activer"} ${boost.name}`} checked={boost.enabled} onchange={(enabled) => toggle(boost, enabled)} />
              <button class="small" onclick={() => edit(boost)} aria-label={`Modifier ${boost.name}`}><Icon name="pencil" size={12} /> Modifier</button>
              <ConfirmButton question="Supprimer ce boost ?" confirmLabel="Supprimer" title={`Supprimer ${boost.name}`} onconfirm={() => api.boosts.remove(boost.id)}>
                <Icon name="trash" size={12} />
              </ConfirmButton>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if loaded && !draft}
      <div class="empty">
        <Icon name="rocket" size={28} />
        <p>Aucun boost.</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .page {
    height: 100%;
    overflow-y: auto;
    animation: rise 0.3s var(--ease);
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 760px;
    margin: 0 auto;
    padding: 36px 32px 64px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 11px;
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--accent-text);
  }
  h1 {
    flex: 1;
    margin: 0;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.03em;
  }
  .intro,
  .hint {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .hint {
    font-size: 12px;
  }
  .action,
  .small {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .action {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  .action:hover,
  .small:hover {
    background: var(--surface-hover);
  }
  .action.primary {
    border-color: transparent;
    background: var(--accent);
    color: var(--on-accent);
  }
  .small {
    height: 26px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 2px);
    background: var(--bg-elevated);
  }
  .editor {
    gap: 14px;
    padding: 16px;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  input,
  select,
  textarea {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  select {
    width: fit-content;
  }
  .code {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
  }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 12px 0 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
  legend {
    padding: 0;
    font-weight: 600;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .label {
    flex: 1;
  }
  .zaps {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .zaps li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .zaps code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warning,
  .error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid color-mix(in oklab, var(--danger, #d93f45) 45%, transparent);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 12px;
    line-height: 1.45;
  }
  .error {
    color: var(--danger, #d93f45);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    border-radius: var(--radius);
  }
  .row:hover {
    background: var(--surface-hover);
  }
  .row.disabled .title,
  .row.disabled .icon {
    opacity: 0.55;
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-muted);
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .title {
    font-weight: 600;
  }
  .detail {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 48px 0 8px;
    color: var(--text-muted);
  }
  .empty p {
    margin: 0;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
