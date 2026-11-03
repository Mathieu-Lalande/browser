<script lang="ts">
  import { LIMITS, type SettingsPatch, type StartBackground } from "@shared/settings";
  import { LAYOUT_PRESETS, applyPreset } from "@shared/start-widgets";
  import { settings } from "../../lib/settings.svelte";
  import Button from "../ui/Button.svelte";
  import Row from "../ui/Row.svelte";
  import Segmented from "../ui/Segmented.svelte";

  /** Settings > Page d'accueil: greeting name, widget layouts, background. */

  const s = $derived(settings.current);
  const update = (patch: SettingsPatch) => settings.update(patch);

  /** URL field of the start page image: saved once complete (on change), not on every keystroke. */
  let imageDraft = $state<string | null>(null);
  let imageError = $state(false);

  function commitImage(event: Event & { currentTarget: HTMLInputElement }): void {
    const value = event.currentTarget.value.trim();
    imageError = value !== "" && !/^https:\/\/\S+$/i.test(value);
    if (imageError) return;
    imageDraft = null;
    update({ startPage: { backgroundImage: value } });
  }
</script>

<Row anchor="name" label="Prénom" hint="Pour un accueil personnalisé : « Bonjour, Mathieu. »" id="greeting-name">
  <input
    id="greeting-name"
    class="ui-field"
    value={s.startPage.greetingName}
    maxlength={LIMITS.greetingName}
    placeholder="Votre prénom"
    autocomplete="off"
    oninput={(event) => update({ startPage: { greetingName: event.currentTarget.value } })}
  />
</Row>
<Row
  anchor="widgets"
  label="Widgets"
  hint="Horloge, recherche, sites fréquents, notes, météo… Bouton « Personnaliser » de la page d'accueil pour les ajouter, les déplacer et les régler."
  keywords="horloge sites fréquents notes météo tâches calendrier disposition"
>
  <div class="actions">
    {#each LAYOUT_PRESETS as preset (preset.id)}
      <Button size="sm" onclick={() => update({ startPage: { widgets: applyPreset(s.startPage.widgets, preset.id) } })}>{preset.label}</Button>
    {/each}
  </div>
</Row>
<Row anchor="background" label="Fond" hint={s.startPage.background === "image" ? "Adresse https d'une image." : undefined}>
  <div class="stack">
    <Segmented
      label="Fond de la page d'accueil"
      value={s.startPage.background}
      options={[
        { value: "theme" as StartBackground, label: "Thème" },
        { value: "aurora" as StartBackground, label: "Aurore" },
        { value: "dynamic" as StartBackground, label: "Dynamique" },
        { value: "image" as StartBackground, label: "Image" },
      ]}
      onchange={(background) => update({ startPage: { background } })}
    />
    {#if s.startPage.background === "image"}
      <input
        class="ui-field wide"
        class:invalid={imageError}
        type="url"
        value={imageDraft ?? s.startPage.backgroundImage}
        placeholder="https://…/image.jpg"
        aria-label="Adresse de l'image de fond"
        aria-invalid={imageError}
        spellcheck="false"
        oninput={(event) => ((imageDraft = event.currentTarget.value), (imageError = false))}
        onchange={commitImage}
      />
    {/if}
  </div>
</Row>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .ui-field {
    width: 220px;
  }
  .ui-field.wide {
    width: min(300px, 100%);
  }
</style>
