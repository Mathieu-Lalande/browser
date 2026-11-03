<script lang="ts">
  import { COUNTRIES, postalCodeValid, type AddressFields } from "@shared/autofill";
  import Button from "../ui/Button.svelte";

  /**
   * The address form of "Adresses et paiements" (ADR-041): adding or editing one address. The
   * field order follows French addresses; main validates everything again.
   */
  let {
    initial,
    onsave,
    oncancel,
  }: { initial?: AddressFields; onsave: (address: AddressFields) => Promise<string | null>; oncancel: () => void } = $props();

  const empty: AddressFields = { name: "", organization: "", street: "", postalCode: "", city: "", region: "", country: "FR", phone: "", email: "" };
  // svelte-ignore state_referenced_locally
  let draft = $state<AddressFields>({ ...empty, ...initial });
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!draft.street.trim() || !(draft.postalCode.trim() || draft.city.trim())) return void (error = "Indiquez au moins l'adresse et la ville ou le code postal.");
    if (draft.postalCode.trim() && draft.country && !postalCodeValid(draft.country, draft.postalCode)) return void (error = "Ce code postal ne correspond pas au pays choisi.");
    busy = true;
    error = await onsave({ ...draft });
    busy = false;
  }
</script>

<form class="editor" aria-label={initial ? "Modifier l'adresse" : "Nouvelle adresse"} onsubmit={submit}>
  <label class="wide">Nom complet <input class="ui-field" autocomplete="off" bind:value={draft.name} /></label>
  <label class="wide">Société <input class="ui-field" autocomplete="off" bind:value={draft.organization} /></label>
  <label class="wide">Adresse <textarea class="ui-field" rows="2" autocomplete="off" bind:value={draft.street}></textarea></label>
  <label>Code postal <input class="ui-field" autocomplete="off" bind:value={draft.postalCode} /></label>
  <label>Ville <input class="ui-field" autocomplete="off" bind:value={draft.city} /></label>
  <label>Région ou état <input class="ui-field" autocomplete="off" bind:value={draft.region} /></label>
  <label
    >Pays
    <select class="ui-field" bind:value={draft.country}>
      <option value="">—</option>
      {#each COUNTRIES as country (country.code)}<option value={country.code}>{country.name}</option>{/each}
    </select>
  </label>
  <label>Téléphone <input class="ui-field" type="tel" autocomplete="off" bind:value={draft.phone} /></label>
  <label>E-mail <input class="ui-field" type="email" autocomplete="off" bind:value={draft.email} /></label>
  {#if error}<p class="error wide" role="alert">{error}</p>{/if}
  <div class="actions wide">
    <Button variant="quiet" onclick={oncancel}>Annuler</Button>
    <Button variant="primary" type="submit" disabled={busy}>Enregistrer</Button>
  </div>
</form>

<style>
  .editor {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .wide {
    grid-column: 1 / -1;
  }
  textarea {
    resize: vertical;
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: var(--text-xs);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
