import { t } from "@shared/i18n";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { WebContents } from "electron";
import {
  EMPTY_AUTOFILL,
  addressOutcome,
  addressSummary,
  byRecentUse,
  captureFromFields,
  cardOutcome,
  fillPlan,
  focusedSection,
  markUsed,
  putAddress,
  putCard,
  removeAddress,
  removeCard,
  sanitizeAutofill,
  sanitizeFields,
  saveAddress,
  saveCard,
  summarizeCard,
  type AddressFields,
  type AutofillCapture,
  type AutofillData,
  type CardInput,
  type FieldDescriptor,
  type FieldSection,
  type SavedAddress,
} from "@shared/autofill";
import type {
  AutofillAnswer,
  AutofillList,
  AutofillPrompt,
  AutofillResult,
  AutofillRevealResult,
  AutofillStatus,
  AutofillSuggestions,
} from "@shared/autofill/ipc";
import { originLabel, passwordOrigin } from "@shared/passwords";
import type { Settings } from "@shared/settings";
import type { Bounds, TabId } from "@shared/types";
import type { WindowPort } from "../ports";
import { EncryptedStore } from "../storage/encrypted-store";
import { AUTOFILL_DESCRIBE_SCRIPT, AUTOFILL_FILL_WORLD_ID, AUTOFILL_WATCH_SCRIPT, AUTOFILL_WATCH_WORLD_ID, autofillFillScript } from "./scripts";

export interface AutofillDeps {
  profileDir: string;
  settings(): Settings;
  /** Asks the user before a card number is shown (OS authentication where there is one). */
  confirmReveal(c: WindowPort): Promise<boolean>;
  plainKeychain?: boolean;
  now?: () => number;
}

const UNAVAILABLE = t("autofillService.systemEncryptionIsntAvailable");
const LOCKED = t("autofillService.savedAddressesCardsCant");
const WRITE_FAILED = t("autofillService.dataCouldntSaved");
const PENDING_TTL = 10 * 60_000;

/** The form a suggestion was offered for: filled when the user picks an entry. */
interface Offer {
  contents: WebContents;
  origin: string;
  fields: FieldDescriptor[];
  section: FieldSection;
}

/**
 * Addresses and payment cards, desktop side (ADR-041): the encrypted store (`autofill.json`,
 * `safeStorage`), the page watch (save prompt after a submitted form, suggestions when a
 * classified field is focused), filling, and what the settings section does. Never in a private
 * window: the watch is not wired there (`pageReady` hook) and every entry point checks it again.
 * A card number reaches the UI only through `revealCard`, after the user confirmed.
 */
export class AutofillService {
  readonly store: EncryptedStore<AutofillData>;
  private readonly pending = new Map<string, { capture: AutofillCapture; window: WindowPort; at: number }>();
  private readonly offers = new WeakMap<WindowPort, Map<TabId, Offer>>();
  private readonly watches = new WeakMap<WebContents, number>();
  private readonly now: () => number;

  constructor(private readonly deps: AutofillDeps) {
    this.now = deps.now ?? Date.now;
    this.store = new EncryptedStore({
      path: join(deps.profileDir, "autofill.json"),
      version: 1,
      empty: EMPTY_AUTOFILL,
      sanitize: sanitizeAutofill,
      plainKeychain: deps.plainKeychain,
    });
  }

  onChanged(listener: () => void): () => void {
    return this.store.onChanged(listener);
  }

  status(): AutofillStatus {
    const status = this.store.status();
    if (!status.available) return { available: false, message: status.reason === "locked" ? LOCKED : UNAVAILABLE, weak: false };
    return { available: true, message: null, weak: status.weak };
  }

  private get settings() {
    return this.deps.settings().autofill;
  }

  private write(next: AutofillData): AutofillResult {
    const status = this.status();
    if (!status.available) return { ok: false, message: status.message ?? UNAVAILABLE };
    return this.store.write(next) ? { ok: true } : { ok: false, message: WRITE_FAILED };
  }

  // --- Pages ------------------------------------------------------------------------------------

  /** Watches a tab's document for submitted and focused forms (each new document: `pageReady`). */
  watch(c: WindowPort, tabId: TabId, contents: WebContents): void {
    if (c.isPrivate) return;
    const token = (this.watches.get(contents) ?? 0) + 1;
    this.watches.set(contents, token);
    void (async () => {
      while (!contents.isDestroyed() && this.watches.get(contents) === token) {
        let event: unknown;
        try {
          event = await contents.executeJavaScriptInIsolatedWorld(AUTOFILL_WATCH_WORLD_ID, [{ code: AUTOFILL_WATCH_SCRIPT }]);
        } catch {
          return;
        }
        if (typeof event !== "object" || event === null) return;
        this.onPageEvent(c, tabId, contents, event as Record<string, unknown>);
      }
    })();
  }

  private onPageEvent(c: WindowPort, tabId: TabId, contents: WebContents, event: Record<string, unknown>): void {
    if (c.isPrivate || c.window.isDestroyed() || contents.isDestroyed()) return;
    const origin = passwordOrigin(contents.getURL());
    if (!origin) return;
    if (event.type === "blur") return void this.closeOffer(c, tabId);
    const fields = sanitizeFields(event.fields);
    if (!fields) return;
    if (event.type === "submit") this.onSubmit(c, tabId, fields);
    else if (event.type === "focus" && typeof event.focused === "number") this.onFocus(c, tabId, contents, origin, fields, event.focused, event.rect);
  }

  private onSubmit(c: WindowPort, tabId: TabId, fields: FieldDescriptor[]): void {
    const { addresses, cards } = this.settings;
    if (!this.status().available || c.tabs.activeTabId !== tabId) return;
    const capture = captureFromFields(fields);
    const data = this.store.current();
    if (!addresses || (capture.address && addressOutcome(data, capture.address) === "same")) capture.address = null;
    if (!cards || (capture.card && cardOutcome(data, capture.card) === "same")) capture.card = null;
    if (!capture.address && !capture.card) return;
    const now = this.now();
    for (const [id, item] of this.pending) if (item.window === c || now - item.at > PENDING_TTL) this.pending.delete(id);
    const captureId = randomBytes(12).toString("base64url");
    this.pending.set(captureId, { capture, window: c, at: now });
    const { x, y } = c.tabs.viewBounds;
    c.overlay.open({ kind: "autofill-save", captureId, anchor: { x: x + 8, y, width: 0, height: 0 } });
  }

  private onFocus(c: WindowPort, tabId: TabId, contents: WebContents, origin: string, fields: FieldDescriptor[], focused: number, rect: unknown): void {
    if (c.tabs.activeTabId !== tabId) return;
    const section = focusedSection(fields, focused);
    if (!section || !this.enabled(section) || !this.status().available || !this.entries(section).length) return;
    this.offerFor(c).set(tabId, { contents, origin, fields, section });
    c.overlay.open({ kind: "autofill-fill", tabId, anchor: anchorOf(c, contents, rect) });
  }

  private enabled(section: FieldSection): boolean {
    return section === "card" ? this.settings.cards : this.settings.addresses;
  }

  private entries(section: FieldSection) {
    const data = this.store.current();
    return section === "card" ? data.cards : data.addresses;
  }

  private offerFor(c: WindowPort): Map<TabId, Offer> {
    let offers = this.offers.get(c);
    if (!offers) this.offers.set(c, (offers = new Map()));
    return offers;
  }

  private closeOffer(c: WindowPort, tabId: TabId): void {
    if (this.offerFor(c).delete(tabId)) c.overlay.close();
  }

  /** What the suggestion popover lists for the tab's offered form. */
  suggestions(c: WindowPort, tabId: TabId): AutofillSuggestions | null {
    const offer = this.offerFor(c).get(tabId);
    if (!offer || c.isPrivate) return null;
    const data = this.store.current();
    return {
      site: originLabel(offer.origin),
      section: offer.section,
      addresses: offer.section === "address" ? byRecentUse(data.addresses).map((entry) => ({ id: entry.id, label: entry.name || entry.organization, detail: addressSummary(entry) })) : [],
      cards: offer.section === "card" ? byRecentUse(data.cards).map(summarizeCard) : [],
    };
  }

  /** Fills the offered form with entry `id`; the page must still be on the offer's origin. */
  async fill(c: WindowPort, tabId: TabId, id: string): Promise<boolean> {
    const offer = this.offerFor(c).get(tabId);
    if (!offer || c.isPrivate || offer.contents.isDestroyed() || passwordOrigin(offer.contents.getURL()) !== offer.origin) return false;
    const data = this.store.current();
    const plan =
      offer.section === "card"
        ? (() => {
            const card = data.cards.find((entry) => entry.id === id);
            return card ? fillPlan(offer.fields, { section: "card", entry: card }) : [];
          })()
        : (() => {
            const address = data.addresses.find((entry) => entry.id === id);
            return address ? fillPlan(offer.fields, { section: "address", entry: address }) : [];
          })();
    if (!plan.length) return false;
    let filled = 0;
    try {
      filled = Number(await offer.contents.executeJavaScriptInIsolatedWorld(AUTOFILL_FILL_WORLD_ID, [{ code: autofillFillScript(offer.origin, offer.fields.length, plan) }], true)) || 0;
    } catch {
      return false;
    }
    if (filled > 0) {
      this.offerFor(c).delete(tabId);
      this.store.write(markUsed(this.store.current(), offer.section, id, this.now()));
    }
    return filled > 0;
  }

  /**
   * The page menu's "Remplir l'adresse / la carte": describes the focused form and opens the
   * suggestions for `section`, if the form has such fields.
   */
  async offerFromMenu(c: WindowPort, tabId: TabId, section: FieldSection): Promise<void> {
    const contents = c.tabs.pageOf(tabId);
    const origin = contents && !contents.isDestroyed() ? passwordOrigin(contents.getURL()) : null;
    if (!contents || !origin || c.isPrivate || !this.enabled(section) || !this.entries(section).length) return;
    let described: unknown;
    try {
      described = await contents.executeJavaScriptInIsolatedWorld(AUTOFILL_FILL_WORLD_ID, [{ code: AUTOFILL_DESCRIBE_SCRIPT }]);
    } catch {
      return;
    }
    const fields = sanitizeFields((described as { fields?: unknown } | null)?.fields);
    if (!fields || !fillPlanPossible(fields, section)) return;
    this.offerFor(c).set(tabId, { contents, origin, fields, section });
    const { x, y } = c.tabs.viewBounds;
    c.overlay.open({ kind: "autofill-fill", tabId, anchor: { x: x + 8, y, width: 0, height: 0 } });
  }

  /** Whether the menu offers to fill an address or a card here (something saved, not private). */
  menuSections(c: WindowPort): FieldSection[] {
    if (c.isPrivate || !this.status().available) return [];
    return (["address", "card"] as const).filter((section) => this.enabled(section) && this.entries(section).length > 0);
  }

  // --- Save prompt --------------------------------------------------------------------------------

  prompt(c: WindowPort, captureId: string): AutofillPrompt | null {
    const item = this.pending.get(captureId);
    if (!item || item.window !== c) return null;
    const { address, card } = item.capture;
    const data = this.store.current();
    return {
      address: address ? { summary: addressSummary(address), name: address.name, update: addressOutcome(data, address) === "update" } : null,
      card: card ? { ...summarizeCard({ id: "", name: card.name, number: card.number, expMonth: card.month, expYear: card.year, nickname: "", createdAt: 0, updatedAt: 0, lastUsedAt: null }), update: cardOutcome(data, card) === "update" } : null,
    };
  }

  answer(c: WindowPort, captureId: string, answer: AutofillAnswer): AutofillResult {
    const item = this.pending.get(captureId);
    if (!item || item.window !== c) return { ok: false, message: t("autofillService.requestHasExpired") };
    this.pending.delete(captureId);
    if (answer === "later" || c.isPrivate) return { ok: true };
    const now = this.now();
    let data = this.store.current();
    try {
      if (item.capture.address) data = saveAddress(data, item.capture.address, now, newId());
      if (item.capture.card) data = saveCard(data, item.capture.card, now, newId());
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : WRITE_FAILED };
    }
    return this.write(data);
  }

  // --- Settings section ---------------------------------------------------------------------------

  list(): AutofillList {
    const data = this.store.current();
    return { addresses: data.addresses, cards: data.cards.map(summarizeCard) };
  }

  putAddress(id: string | null, fields: AddressFields): AutofillResult {
    try {
      return this.write(putAddress(this.store.current(), id ?? newId(), fields, this.now()));
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : WRITE_FAILED };
    }
  }

  putCard(id: string | null, input: CardInput): AutofillResult {
    const next = putCard(this.store.current(), id ?? newId(), input, this.now());
    return "error" in next ? { ok: false, message: next.error } : this.write(next);
  }

  remove(section: FieldSection, id: string): AutofillResult {
    const data = this.store.current();
    return this.write(section === "card" ? removeCard(data, id) : removeAddress(data, id));
  }

  /** A card's number, after the user confirmed (OS authentication when available). */
  async revealCard(c: WindowPort, id: string): Promise<AutofillRevealResult> {
    const card = this.store.current().cards.find((entry) => entry.id === id);
    if (!card) return { ok: false, message: t("autofillService.cardNoLongerExists") };
    if (!(await this.deps.confirmReveal(c))) return { ok: false, message: t("autofillService.displayCanceled") };
    return { ok: true, number: card.number };
  }

  /** Synced addresses (ADR-019, opt-in): local records, and remote winners applied. */
  addresses(): SavedAddress[] {
    return this.store.current().addresses;
  }

  replace(next: AutofillData): void {
    this.store.write(next);
  }
}

const newId = () => randomBytes(12).toString("base64url");

const fillPlanPossible = (fields: FieldDescriptor[], section: FieldSection) => fields.some((_, index) => focusedSection(fields, index) === section);

/** The focused field's rectangle (page CSS px) in window coordinates, for the popover's anchor. */
function anchorOf(c: WindowPort, contents: WebContents, rect: unknown): Bounds {
  const view = c.tabs.viewBounds;
  const box = (typeof rect === "object" && rect !== null ? rect : {}) as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const zoom = contents.getZoomFactor();
  const x = Math.min(Math.max(0, num(box.x) * zoom), view.width);
  const y = Math.min(Math.max(0, num(box.y) * zoom), view.height);
  return { x: Math.round(view.x + x), y: Math.round(view.y + y), width: Math.round(Math.min(num(box.width) * zoom, view.width)), height: Math.round(Math.min(num(box.height) * zoom, 200)) };
}
