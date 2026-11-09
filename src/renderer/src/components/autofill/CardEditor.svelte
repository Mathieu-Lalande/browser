<script lang="ts">
  import { t } from "@shared/i18n";
  import { CARD_BRAND_LABELS, cardBrand, cardDigits, isValidCardNumber, type CardInput, type CardSummary } from "@shared/autofill";
  import Button from "../ui/Button.svelte";

  /**
   * The card form of "Adresses et paiements" (ADR-041). Editing never shows the saved number: an
   * empty number keeps it. There is no field for the security code, which is never stored.
   */
  let {
    initial,
    onsave,
    oncancel,
  }: { initial?: CardSummary; onsave: (card: CardInput) => Promise<string | null>; oncancel: () => void } = $props();

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 16 }, (_, index) => thisYear - 1 + index);
  // svelte-ignore state_referenced_locally
  let draft = $state({
    name: initial?.name ?? "",
    number: "",
    expMonth: initial?.expMonth ?? new Date().getMonth() + 1,
    expYear: initial?.expYear ?? thisYear + 3,
    nickname: initial?.nickname ?? "",
  });
  let error = $state<string | null>(null);
  let busy = $state(false);

  const digits = $derived(cardDigits(draft.number) ?? "");
  const brand = $derived(digits.length >= 2 ? CARD_BRAND_LABELS[cardBrand(digits)] : null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!initial || draft.number.trim()) {
      if (!isValidCardNumber(draft.number)) return void (error = t("cardEditor.cardNumberIsntValid"));
    }
    busy = true;
    error = await onsave({ ...draft, number: digits });
    busy = false;
  }
</script>

<form class="editor" aria-label={initial ? t("cardEditor.editCard") : t("cardEditor.newCard")} onsubmit={submit}>
  <label class="wide">{t("cardEditor.cardholder")} <input class="ui-field" autocomplete="off" bind:value={draft.name} /></label>
  <label class="wide"
    >{t("cardEditor.number")} {#if brand}<span class="brand">{brand}</span>{/if}
    <input
      class="ui-field"
      inputmode="numeric"
      autocomplete="off"
      placeholder={initial ? t("cardEditor.unchanged", { last4: initial.last4 }) : "1234 5678 9012 3456"}
      bind:value={draft.number}
    />
  </label>
  <label
    >{t("cardEditor.expirationMonth")}
    <select class="ui-field" bind:value={draft.expMonth}>
      {#each Array.from({ length: 12 }, (_, index) => index + 1) as month (month)}<option value={month}>{String(month).padStart(2, "0")}</option>{/each}
    </select>
  </label>
  <label
    >{t("cardEditor.year")}
    <select class="ui-field" bind:value={draft.expYear}>
      {#each years as year (year)}<option value={year}>{year}</option>{/each}
    </select>
  </label>
  <label class="wide">{t("cardEditor.cardNameOptional")} <input class="ui-field" autocomplete="off" bind:value={draft.nickname} /></label>
  <p class="hint wide">{t("cardEditor.securityCodeCvcNever")}</p>
  {#if error}<p class="error wide" role="alert">{error}</p>{/if}
  <div class="actions wide">
    <Button variant="quiet" onclick={oncancel}>{t("cardEditor.cancel")}</Button>
    <Button variant="primary" type="submit" disabled={busy}>{t("cardEditor.save")}</Button>
  </div>
</form>

<style>
  .editor {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
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
  .brand {
    color: var(--accent-text);
  }
  .hint,
  .error {
    margin: 0;
    font-size: var(--text-xs);
  }
  .hint {
    color: var(--text-faint);
  }
  .error {
    color: var(--danger);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
