<script lang="ts">
  import { CARD_BRAND_LABELS, maskCardNumber, type AutofillPrompt, type AutofillSuggestions } from "@shared/autofill";
  import type { Bounds, TabId } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import { dismiss } from "../components/ui/dismiss";
  import Icon from "../components/Icon.svelte";
  import Button from "../components/ui/Button.svelte";

  /**
   * Autofill popovers of the overlay layer (ADR-041). "save": after a form was sent, "Enregistrer
   * cette adresse / carte ?" (main keeps the capture; a card shows its last digits). "fill": the
   * addresses or cards for the focused form, under the field; picking one asks main to fill.
   */
  let {
    kind,
    anchor,
    captureId,
    tabId,
    onClose,
  }: { kind: "save" | "fill"; anchor?: Bounds; captureId?: string; tabId?: TabId; onClose: (restoreFocus: boolean) => void } = $props();

  const WIDTH = 320;
  const MARGIN = 8;

  let panel = $state<HTMLElement>();
  let innerWidth = $state(window.innerWidth);
  let innerHeight = $state(window.innerHeight);
  let prompt = $state<AutofillPrompt | null>(null);
  let suggestions = $state<AutofillSuggestions | null>(null);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const position = $derived.by(() => {
    const box = anchor ?? { x: MARGIN, y: MARGIN, width: 0, height: 0 };
    const below = box.y + box.height + 4;
    const left = Math.max(MARGIN, Math.min(box.x, innerWidth - WIDTH - MARGIN));
    return { left, top: Math.max(MARGIN, below), maxHeight: Math.max(140, innerHeight - below - MARGIN) };
  });

  $effect(() => {
    const done = () => (loaded = true);
    if (kind === "save" && captureId) void api.autofill.prompt(captureId).then((next) => (prompt = next), () => null).finally(done);
    else if (kind === "fill" && tabId) void api.autofill.suggestions(tabId).then((next) => (suggestions = next), () => null).finally(done);
    else done();
  });
  $effect(() => panel?.focus());

  const title = $derived.by(() => {
    if (!prompt) return "";
    if (prompt.address && prompt.card) return "Enregistrer cette adresse et cette carte ?";
    if (prompt.card) return prompt.card.update ? "Mettre à jour cette carte ?" : "Enregistrer cette carte ?";
    return prompt.address?.update ? "Mettre à jour cette adresse ?" : "Enregistrer cette adresse ?";
  });

  async function answer(choice: "save" | "later"): Promise<void> {
    if (!captureId || busy) return;
    busy = true;
    const result = await api.autofill.answer(captureId, choice).catch(() => ({ ok: false as const, message: "Rien n'a été enregistré." }));
    busy = false;
    if (result.ok) onClose(false);
    else error = result.message;
  }

  async function fill(id: string): Promise<void> {
    if (!tabId || busy) return;
    busy = true;
    const filled = await api.autofill.fill(tabId, id).catch(() => false);
    busy = false;
    if (filled) onClose(false);
    else error = "Ce formulaire n'a pas pu être rempli.";
  }

  /** Arrow keys move between the entries (the list is a menu). */
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(panel?.querySelectorAll<HTMLButtonElement>(".entries button") ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next].focus();
  }

  const expiry = (month: number, year: number) => `${String(month).padStart(2, "0")}/${String(year % 100).padStart(2, "0")}`;
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={panel}
  use:dismiss={{ onDismiss: () => onClose(true) }}
  class="panel"
  role="dialog"
  aria-label={kind === "save" ? "Enregistrer pour les formulaires" : "Remplir le formulaire"}
  tabindex="-1"
  onkeydown={onKeydown}
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:max-height="{position.maxHeight}px"
  style:width="{Math.min(WIDTH, innerWidth - 2 * MARGIN)}px"
>
  {#if kind === "save" && prompt}
    <header>
      <span class="badge"><Icon name={prompt.card ? "credit-card" : "map-pin"} size={16} /></span>
      <h2>{title}</h2>
    </header>
    {#if prompt.address}
      <p class="item"><Icon name="map-pin" size={14} /> <span>{prompt.address.name ? `${prompt.address.name}, ` : ""}{prompt.address.summary}</span></p>
    {/if}
    {#if prompt.card}
      <p class="item">
        <Icon name="credit-card" size={14} />
        <span>{CARD_BRAND_LABELS[prompt.card.brand]} {maskCardNumber(prompt.card.last4)} · {expiry(prompt.card.expMonth, prompt.card.expYear)}</span>
      </p>
    {/if}
    <p class="hint">Chiffré et enregistré sur cet appareil. Le code de sécurité n'est jamais enregistré.</p>
    {#if error}<p class="error" role="alert"><Icon name="warning" size={12} /> {error}</p>{/if}
    <div class="buttons">
      <Button variant="quiet" size="sm" disabled={busy} onclick={() => answer("later")}>Plus tard</Button>
      <Button variant="primary" size="sm" disabled={busy} onclick={() => answer("save")}>Enregistrer</Button>
    </div>
  {:else if kind === "fill" && suggestions}
    <ul class="entries" aria-label={suggestions.section === "card" ? "Cartes enregistrées" : "Adresses enregistrées"}>
      {#each suggestions.addresses as address (address.id)}
        <li>
          <button disabled={busy} onclick={() => fill(address.id)}>
            <Icon name="map-pin" size={14} />
            <span class="text"><span class="name">{address.label || address.detail}</span>{#if address.label}<span class="detail">{address.detail}</span>{/if}</span>
          </button>
        </li>
      {/each}
      {#each suggestions.cards as card (card.id)}
        <li>
          <button disabled={busy} onclick={() => fill(card.id)}>
            <Icon name="credit-card" size={14} />
            <span class="text">
              <span class="name">{card.nickname || CARD_BRAND_LABELS[card.brand]} {maskCardNumber(card.last4)}</span>
              <span class="detail">{card.name || "Sans titulaire"} · {expiry(card.expMonth, card.expYear)}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if error}<p class="error" role="alert"><Icon name="warning" size={12} /> {error}</p>{/if}
    <div class="buttons">
      <Button variant="quiet" size="sm" onclick={() => (api.commands.run("open-settings"), onClose(false))}>Gérer les adresses et cartes</Button>
    </div>
  {:else if loaded}
    <p class="hint">Cette demande n'est plus disponible.</p>
  {/if}
</div>

<style>
  .panel {
    position: fixed;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    overflow: auto;
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55),
      0 4px 14px -6px rgb(0 0 0 / 0.35);
    outline: none;
    animation: pop var(--motion-fast) var(--ease);
    transform-origin: top left;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: var(--accent-text);
  }
  h2 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
  }
  p {
    margin: 0;
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
    overflow-wrap: anywhere;
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .error {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--danger);
    font-size: var(--text-xs);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-1);
  }
  .entries {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .entries button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--hit-min);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .entries button:hover:not(:disabled),
  .entries button:focus-visible {
    background: var(--surface-hover);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name,
  .detail {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .detail {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>
