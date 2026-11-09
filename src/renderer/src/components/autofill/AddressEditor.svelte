<script lang="ts">
  import { t } from "@shared/i18n";
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
    if (!draft.street.trim() || !(draft.postalCode.trim() || draft.city.trim())) return void (error = t("addressEditor.enterLeastAddressCity"));
    if (draft.postalCode.trim() && draft.country && !postalCodeValid(draft.country, draft.postalCode)) return void (error = t("addressEditor.postalCodeDoesntMatch"));
    busy = true;
    error = await onsave({ ...draft });
    busy = false;
  }
</script>

<form class="editor" aria-label={initial ? t("addressEditor.editAddress") : t("addressEditor.newAddress")} onsubmit={submit}>
  <label class="wide">{t("addressEditor.fullName")} <input class="ui-field" autocomplete="off" bind:value={draft.name} /></label>
  <label class="wide">{t("addressEditor.company")} <input class="ui-field" autocomplete="off" bind:value={draft.organization} /></label>
  <label class="wide">{t("addressEditor.address")} <textarea class="ui-field" rows="2" autocomplete="off" bind:value={draft.street}></textarea></label>
  <label>{t("addressEditor.postalCode")} <input class="ui-field" autocomplete="off" bind:value={draft.postalCode} /></label>
  <label>{t("addressEditor.city")} <input class="ui-field" autocomplete="off" bind:value={draft.city} /></label>
  <label>{t("addressEditor.regionState")} <input class="ui-field" autocomplete="off" bind:value={draft.region} /></label>
  <label
    >{t("addressEditor.country")}
    <select class="ui-field" bind:value={draft.country}>
      <option value="">—</option>
      {#each COUNTRIES as country (country.code)}<option value={country.code}>{country.name}</option>{/each}
    </select>
  </label>
  <label>{t("addressEditor.phone")} <input class="ui-field" type="tel" autocomplete="off" bind:value={draft.phone} /></label>
  <label>{t("addressEditor.email")} <input class="ui-field" type="email" autocomplete="off" bind:value={draft.email} /></label>
  {#if error}<p class="error wide" role="alert">{error}</p>{/if}
  <div class="actions wide">
    <Button variant="quiet" onclick={oncancel}>{t("addressEditor.cancel")}</Button>
    <Button variant="primary" type="submit" disabled={busy}>{t("addressEditor.save")}</Button>
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
