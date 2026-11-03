<script lang="ts">
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
    const error = failure(await api.autofill.putAddress(id, address).catch(() => ({ ok: false as const, message: "L'adresse n'a pas été enregistrée." })));
    if (!error) editingAddress = null;
    return error;
  }

  async function saveCard(id: string | null, card: CardInput): Promise<string | null> {
    const error = failure(await api.autofill.putCard(id, card).catch(() => ({ ok: false as const, message: "La carte n'a pas été enregistrée." })));
    if (!error) editingCard = null;
    return error;
  }

  async function remove(section: "address" | "card", id: string): Promise<void> {
    message = failure(await api.autofill.remove(section, id).catch(() => ({ ok: false as const, message: "La suppression a échoué." })));
  }

  async function reveal(card: CardSummary): Promise<void> {
    if (revealed[card.id]) return void delete revealed[card.id];
    const result = await api.autofill.revealCard(card.id).catch(() => ({ ok: false as const, message: "Le numéro n'a pas pu être affiché." }));
    if (result.ok) revealed[card.id] = result.number;
    else message = result.message;
  }

  const addressById = (id: string): SavedAddress | undefined => list.addresses.find((entry) => entry.id === id);
  const expiry = (card: CardSummary) => `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear % 100).padStart(2, "0")}`;
</script>

{#if browser.isPrivate}
  <p class="note">Les adresses et les cartes ne sont ni proposées ni enregistrées en navigation privée.</p>
{:else}
  {#if status && !status.available}
    <!-- A standing state of the device, not an event: no alert role (the page has other alerts). -->
    <p class="notice"><Icon name="warning" size={14} /> <span>{status.message}</span></p>
  {:else if status?.weak}
    <p class="notice"><Icon name="warning" size={14} /> <span>Aucun trousseau système : la protection de ces données est faible sur cet appareil.</span></p>
  {/if}
  <Row anchor="addresses" label="Enregistrer et remplir les adresses" hint="Proposé après l'envoi d'un formulaire, puis suggéré dans les champs d'adresse." keywords="adresse livraison facturation formulaire autofill">
    <Toggle label="Enregistrer et remplir les adresses" checked={a.addresses} onchange={(addresses) => settings.update({ autofill: { addresses } })} />
  </Row>
  <Row anchor="cards" label="Enregistrer et remplir les cartes de paiement" hint="Numéro chiffré sur cet appareil. Le code de sécurité (CVC) n'est jamais enregistré." keywords="carte bancaire crédit paiement visa mastercard">
    <Toggle label="Enregistrer et remplir les cartes de paiement" checked={a.cards} onchange={(cards) => settings.update({ autofill: { cards } })} />
  </Row>
  <Row anchor="sync-addresses" label="Synchroniser les adresses" hint="Chiffrées de bout en bout avec le reste de la synchronisation. Les cartes ne quittent jamais cet appareil." keywords="synchronisation appareils">
    <Toggle label="Synchroniser les adresses" checked={a.syncAddresses} onchange={(syncAddresses) => settings.update({ autofill: { syncAddresses } })} />
  </Row>

  <Row anchor="address-list" label="Adresses" stacked>
    {#if list.addresses.length}
      <Card aria-label="Adresses enregistrées" data-testid="autofill-addresses">
        {#each list.addresses as address (address.id)}
          <ListRow>
            <Icon name="map-pin" size={14} />
            <span class="main">
              <span class="title">{address.name || address.organization || "Adresse"}</span>
              <span class="detail">{addressSummary(address)}</span>
            </span>
            <IconButton icon="pencil" size="row" label="Modifier l'adresse de {address.name || addressSummary(address)}" onclick={() => (editingAddress = address.id)} />
            <ConfirmButton question="Supprimer cette adresse ?" confirmLabel="Supprimer" onconfirm={() => remove("address", address.id)} title="Supprimer l'adresse">
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
      <div><Button icon="plus" disabled={!status?.available} onclick={() => (editingAddress = "new")}>Ajouter une adresse</Button></div>
    {/if}
  </Row>

  <Row anchor="card-list" label="Cartes de paiement" stacked>
    {#if list.cards.length}
      <Card aria-label="Cartes enregistrées" data-testid="autofill-cards">
        {#each list.cards as card (card.id)}
          <ListRow>
            <Icon name="credit-card" size={14} />
            <span class="main">
              <span class="title">{card.nickname || CARD_BRAND_LABELS[card.brand]} <span class="number" data-testid="card-number">{revealed[card.id] ? formatCardNumber(revealed[card.id]) : maskCardNumber(card.last4)}</span></span>
              <span class="detail">{card.name || "Sans titulaire"} · expire fin {expiry(card)}</span>
            </span>
            <IconButton icon={revealed[card.id] ? "eye-off" : "eye"} size="row" label={revealed[card.id] ? "Masquer le numéro" : "Afficher le numéro"} onclick={() => reveal(card)} />
            <IconButton icon="pencil" size="row" label="Modifier la carte {maskCardNumber(card.last4)}" onclick={() => (editingCard = card.id)} />
            <ConfirmButton question="Supprimer cette carte ?" confirmLabel="Supprimer" onconfirm={() => remove("card", card.id)} title="Supprimer la carte">
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
      <div><Button icon="plus" disabled={!status?.available} onclick={() => (editingCard = "new")}>Ajouter une carte</Button></div>
    {/if}
  </Row>
  {#if message}<p class="notice" role="alert"><Icon name="warning" size={14} /> <span>{message}</span></p>{/if}
{/if}

<style>
  .note {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .notice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
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
