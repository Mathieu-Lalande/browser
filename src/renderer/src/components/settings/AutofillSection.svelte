<script lang="ts">
  import { t as tr, t } from "@shared/i18n";
  import {
    CARD_BRAND_LABELS,
    addressSummary,
    formatCardNumber,
    maskCardNumber,
    type AddressFields,
    type AutofillList,
    type AutofillResult,
    type AutofillStatus,
    type CardInput,
    type CardSummary,
    type SavedAddress,
  } from "@shared/autofill";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import AddressEditor from "../autofill/AddressEditor.svelte";
  import CardEditor from "../autofill/CardEditor.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import ListRow from "../ui/ListRow.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /**
   * "Adresses et paiements" (ADR-041): what is offered and synced, the saved addresses and cards
   * (encrypted on this device), their forms. A card shows its last digits; the whole number only
   * after main asked the user (Touch ID or a system dialog). Nothing of this in a private window.
   */
  const a = $derived(settings.current.autofill);

  let status = $state<AutofillStatus | null>(null);
  let list = $state<AutofillList>({ addresses: [], cards: [] });
  /** Which form is open: "new" or the id being edited. */
  let editingAddress = $state<string | null>(null);
  let editingCard = $state<string | null>(null);
  /** Revealed card numbers, by id, until the page goes. */
  let revealed = $state<Record<string, string>>({});
  let message = $state<string | null>(null);

  const refresh = () => {
    void api.autofill.status().then((next) => (status = next), () => null);
    void api.autofill.list().then((next) => (list = next), () => null);
  };
  $effect(() => {
    if (browser.isPrivate) return;
    refresh();
    return api.autofill.onChanged(refresh);
  });

  const failure = (result: AutofillResult) => (result.ok ? null : result.message);

  async function saveAddress(id: string | null, address: AddressFields): Promise<string | null> {
    const error = failure(await api.autofill.putAddress(id, address).catch(() => ({ ok: false as const, message: t("autofillSection.addressWasntSaved") })));
    if (!error) editingAddress = null;
    return error;
  }

  async function saveCard(id: string | null, card: CardInput): Promise<string | null> {
    const error = failure(await api.autofill.putCard(id, card).catch(() => ({ ok: false as const, message: t("autofillSection.cardWasntSaved") })));
    if (!error) editingCard = null;
    return error;
  }

  async function remove(section: "address" | "card", id: string): Promise<void> {
    message = failure(await api.autofill.remove(section, id).catch(() => ({ ok: false as const, message: t("autofillSection.deletionFailed") })));
  }

  async function reveal(card: CardSummary): Promise<void> {
    if (revealed[card.id]) return void delete revealed[card.id];
    const result = await api.autofill.revealCard(card.id).catch(() => ({ ok: false as const, message: t("autofillSection.numberCouldntShown") }));
    if (result.ok) revealed[card.id] = result.number;
    else message = result.message;
  }

  const addressById = (id: string): SavedAddress | undefined => list.addresses.find((entry) => entry.id === id);
  const expiry = (card: CardSummary) => `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear % 100).padStart(2, "0")}`;
</script>

{#if browser.isPrivate}
  <p class="note">{t("autofillSection.addressesCardsAreNeither")}</p>
{:else}
  {#if status && !status.available}
    <!-- A standing state of the device, not an event: no alert role (the page has other alerts). -->
    <p class="notice"><Icon name="warning" size={14} /> <span>{status.message}</span></p>
  {:else if status?.weak}
    <p class="notice"><Icon name="warning" size={14} /> <span>{t("autofillSection.noSystemKeychainProtection")}</span></p>
  {/if}
  <Row anchor="addresses" label={t("autofillSection.saveFillAddresses")} hint={t("autofillSection.offeredAfterFormSent")} keywords={t("autofillSection.addressShippingBillingForm")}>
    <Toggle label={t("autofillSection.saveFillAddresses")} checked={a.addresses} onchange={(addresses) => settings.update({ autofill: { addresses } })} />
  </Row>
  <Row anchor="cards" label={t("autofillSection.saveFillPaymentCards")} hint={t("autofillSection.numberEncryptedDeviceSecurity")} keywords={t("autofillSection.bankCardCreditPayment")}>
    <Toggle label={t("autofillSection.saveFillPaymentCards")} checked={a.cards} onchange={(cards) => settings.update({ autofill: { cards } })} />
  </Row>
  <Row anchor="sync-addresses" label={t("autofillSection.syncAddresses")} hint={t("autofillSection.endEndEncryptedRest")} keywords={t("autofillSection.syncDevices")}>
    <Toggle label={t("autofillSection.syncAddresses")} checked={a.syncAddresses} onchange={(syncAddresses) => settings.update({ autofill: { syncAddresses } })} />
  </Row>

  <Row anchor="address-list" label={t("autofillSection.addresses")} stacked>
    {#if list.addresses.length}
      <Card aria-label={t("autofillSection.savedAddresses")} data-testid="autofill-addresses">
        {#each list.addresses as address (address.id)}
          <ListRow>
            <Icon name="map-pin" size={14} />
            <span class="main">
              <span class="title">{address.name || address.organization || tr("autofillSection.address")}</span>
              <span class="detail">{addressSummary(address)}</span>
            </span>
            <IconButton icon="pencil" size="row" label={t("autofillSection.editAddress", { p: address.name || addressSummary(address) })} onclick={() => (editingAddress = address.id)} />
            <ConfirmButton question={t("autofillSection.deleteAddress")} confirmLabel={t("autofillSection.delete")} onconfirm={() => remove("address", address.id)} title={t("autofillSection.deleteAddress2")}>
              <Icon name="trash" size={14} />
            </ConfirmButton>
          </ListRow>
        {/each}
      </Card>
    {/if}
    {#if editingAddress}
      {@const current = editingAddress === "new" ? undefined : addressById(editingAddress)}
      <Card as="div" variant="section">
        <AddressEditor initial={current} onsave={(address) => saveAddress(current?.id ?? null, address)} oncancel={() => (editingAddress = null)} />
      </Card>
    {:else}
      <div><Button icon="plus" disabled={!status?.available} onclick={() => (editingAddress = "new")}>{t("autofillSection.addAddress")}</Button></div>
    {/if}
  </Row>

  <Row anchor="card-list" label={t("autofillSection.paymentCards")} stacked>
    {#if list.cards.length}
      <Card aria-label={t("autofillSection.savedCards")} data-testid="autofill-cards">
        {#each list.cards as card (card.id)}
          <ListRow>
            <Icon name="credit-card" size={14} />
            <span class="main">
              <span class="title">{card.nickname || CARD_BRAND_LABELS[card.brand]} <span class="number" data-testid="card-number">{revealed[card.id] ? formatCardNumber(revealed[card.id]) : maskCardNumber(card.last4)}</span></span>
              <span class="detail">{t("autofillSection.cardDetail", { name: card.name || t("autofillSection.noCardholder"), expiry: expiry(card) })}</span>
            </span>
            <IconButton icon={revealed[card.id] ? "eye-off" : "eye"} size="row" label={revealed[card.id] ? t("autofillSection.hideNumber") : t("autofillSection.showNumber")} onclick={() => reveal(card)} />
            <IconButton icon="pencil" size="row" label={t("autofillSection.editCard", { p: maskCardNumber(card.last4) })} onclick={() => (editingCard = card.id)} />
            <ConfirmButton question={t("autofillSection.deleteCard")} confirmLabel={t("autofillSection.delete")} onconfirm={() => remove("card", card.id)} title={t("autofillSection.deleteCard2")}>
              <Icon name="trash" size={14} />
            </ConfirmButton>
          </ListRow>
        {/each}
      </Card>
    {/if}
    {#if editingCard}
      {@const current = editingCard === "new" ? undefined : list.cards.find((card) => card.id === editingCard)}
      <Card as="div" variant="section">
        <CardEditor initial={current} onsave={(card) => saveCard(current?.id ?? null, card)} oncancel={() => (editingCard = null)} />
      </Card>
    {:else}
      <div><Button icon="plus" disabled={!status?.available} onclick={() => (editingCard = "new")}>{t("autofillSection.addCard")}</Button></div>
    {/if}
  </Row>
  {#if message}<p class="notice" role="alert"><Icon name="warning" size={14} /> <span>{message}</span></p>{/if}
{/if}

<style>
  .note {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  /* Lines of the section card itself: the inner margin of its rows (`Row`). */
  .notice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3) var(--space-4);
    color: var(--danger);
    font-size: var(--text-xs);
  }
  .main {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .number {
    margin-left: var(--space-2);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .detail {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
