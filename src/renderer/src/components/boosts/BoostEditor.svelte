<script lang="ts">
  import { untrack } from "svelte";
  import { BOOST_FONTS, FILTER_RANGES, MAX_BOOST_CSS, MAX_BOOST_SCRIPT, type BoostFont, type BoostInput, type FilterAmount } from "@shared/boosts";
  import Icon from "../Icon.svelte";
  import Slider from "../settings/Slider.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /**
   * The boost editor of `browser://boosts` (ADR-029): edits a copy of `initial`; `onsave` sends the
   * whole boost to main, which validates it and answers with a message to fix (shown here) or null.
   */
  let { initial, onsave, oncancel }: { initial: BoostInput; onsave: (boost: BoostInput) => Promise<string | null>; oncancel: () => void } = $props();

  let draft = $state(untrack(() => structuredClone(initial)));
  let error = $state<string | null>(null);

  async function save(): Promise<void> {
    error = await onsave($state.snapshot(draft));
  }

  const FILTER_LABELS: Record<FilterAmount, string> = { grayscale: "Niveaux de gris", sepia: "Sépia", brightness: "Luminosité", contrast: "Contraste" };
</script>

<Card as="form" class="editor" aria-label="Modifier le boost" onsubmit={(event) => (event.preventDefault(), void save())}>
  <div class="fields">
    <label class="field">
      <span>Site</span>
      <input class="ui-field" bind:value={draft.match} placeholder="exemple.fr ou *.exemple.fr" spellcheck="false" autocomplete="off" data-testid="boost-match" />
    </label>
    <label class="field">
      <span>Nom</span>
      <input class="ui-field" bind:value={draft.name} placeholder="Facultatif" maxlength="80" />
    </label>
  </div>

  <fieldset>
    <legend>Couleurs</legend>
    <div class="kit-line">
      <span class="kit-label">Inverser les couleurs</span>
      <Toggle label="Inverser les couleurs" checked={draft.filters.invert} onchange={(value) => (draft.filters.invert = value)} />
    </div>
    {#each Object.keys(FILTER_LABELS) as FilterAmount[] as key (key)}
      <div class="kit-line">
        <span class="kit-label">{FILTER_LABELS[key]}</span>
        <Slider
          label={FILTER_LABELS[key]}
          value={draft.filters[key]}
          min={FILTER_RANGES[key].min}
          max={FILTER_RANGES[key].max}
          unit="%"
          onchange={(value) => (draft.filters[key] = value)}
        />
      </div>
    {/each}
  </fieldset>

  <fieldset>
    <legend>Police</legend>
    <select class="ui-field" aria-label="Police" value={draft.font ?? ""} onchange={(event) => (draft.font = (event.currentTarget.value || null) as BoostFont | null)}>
      <option value="">Police du site</option>
      {#each Object.entries(BOOST_FONTS) as [id, font] (id)}<option value={id}>{font.label}</option>{/each}
    </select>
  </fieldset>

  <fieldset>
    <legend>Éléments masqués</legend>
    {#if draft.zaps.length}
      <ul class="kit-list">
        {#each draft.zaps as selector (selector)}
          <li>
            <code class="kit-code selector">{selector}</code>
            <Button variant="quiet" size="sm" onclick={() => (draft.zaps = draft.zaps.filter((item) => item !== selector))}>
              <Icon name="undo" size={12} /> Réafficher
            </Button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="kit-hint">Aucun. Ouvrez le site puis « Masquer des éléments ».</p>
    {/if}
  </fieldset>

  <fieldset>
    <legend>CSS personnalisé</legend>
    <textarea
      class="ui-field code"
      bind:value={draft.css}
      rows="8"
      spellcheck="false"
      maxlength={MAX_BOOST_CSS}
      placeholder={"body {\n  max-width: 900px;\n}"}
      aria-label="CSS personnalisé"
    ></textarea>
  </fieldset>

  <fieldset>
    <legend>JavaScript</legend>
    <div class="kit-line">
      <span class="kit-label">Exécuter un script sur ce site</span>
      <Toggle label="Exécuter un script sur ce site" checked={draft.script.enabled} onchange={(value) => (draft.script.enabled = value)} />
    </div>
    {#if draft.script.enabled}
      <p class="notice" role="note">
        <Icon name="warning" size={14} />
        <span>
          Un script peut lire et modifier tout ce que la page affiche, y compris ce que vous y saisissez. N'ajoutez que du code que vous
          comprenez. Il s'exécute isolé des scripts de la page, au chargement, et il est synchronisé avec vos appareils.
        </span>
      </p>
      <textarea class="ui-field code" bind:value={draft.script.code} rows="8" spellcheck="false" maxlength={MAX_BOOST_SCRIPT} aria-label="Script"></textarea>
      <div class="kit-line">
        <span class="kit-label">Aussi en navigation privée</span>
        <Toggle label="Exécuter aussi en navigation privée" checked={draft.script.allowPrivate} onchange={(value) => (draft.script.allowPrivate = value)} />
      </div>
    {/if}
  </fieldset>

  {#if error}<p class="notice error" role="alert"><Icon name="warning" size={14} /> {error}</p>{/if}
  <div class="kit-actions">
    <Button onclick={oncancel}>Annuler</Button>
    <Button variant="primary" type="submit">Enregistrer</Button>
  </div>
</Card>

<style>
  :global(form.card.list.editor) {
    gap: 14px;
    padding: var(--space-4);
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  select {
    width: fit-content;
  }
  .code {
    width: 100%;
    height: auto;
    box-sizing: border-box;
    padding: 6px var(--space-2);
    resize: vertical;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: var(--text-xs);
    line-height: 1.5;
  }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3) 0 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
  legend {
    padding: 0;
    font-weight: 600;
  }
  .selector {
    flex: 1;
    min-width: 0;
    font-size: 11.5px;
  }
  .notice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) 10px;
    border: 1px solid color-mix(in oklab, var(--danger) 45%, transparent);
    border-radius: var(--radius);
    color: var(--text);
    font-size: var(--text-xs);
    line-height: 1.45;
  }
  .notice.error {
    color: var(--danger-text);
  }
</style>
