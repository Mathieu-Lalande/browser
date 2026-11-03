import { isAutofillAnswer, isAutofillId, isFieldSection, sanitizeAddressFields, sanitizeCardInput, type AddressFields, type CardInput } from "@shared/autofill";
import { Channels } from "@shared/ipc";
import { isDictionaryWord } from "@shared/spellcheck";
import { appServices } from "../app-services-ref";
import { custom, defineHandlers, handle, handleUi, nullable, record, str } from "./registry";

const autofill = () => appServices().autofill;
const spellcheck = () => appServices().spellcheck;

const addressInput = custom<AddressFields>((value) => record(4000)(value) && sanitizeAddressFields(value) !== null);
const cardInput = custom<CardInput>((value) => record(1000)(value) && !("error" in sanitizeCardInput(value, false)));
const refused = { ok: false, message: "Les adresses et les cartes se gèrent depuis une fenêtre normale." } as const;

/**
 * Addresses and cards (ADR-041): entries by id, tabs of the sender's own window (main reads their
 * page). Every change is refused from a private window; a card number only leaves main through
 * `revealCard`, after main asked the user itself.
 */
export const autofillHandlers = defineHandlers({
  [Channels.autofillStatus]: handleUi([], () => autofill().status()),
  [Channels.autofillList]: handle([], (c) => (c.isPrivate ? { addresses: [], cards: [] } : autofill().list())),
  [Channels.autofillPutAddress]: handle([nullable(isAutofillId), addressInput], (c, id, address) =>
    c.isPrivate ? refused : autofill().putAddress(id, sanitizeAddressFields(address)!),
  ),
  [Channels.autofillPutCard]: handle([nullable(isAutofillId), cardInput], (c, id, card) => {
    if (c.isPrivate) return refused;
    const input = sanitizeCardInput(card, id === null);
    return "error" in input ? { ok: false as const, message: input.error } : autofill().putCard(id, input);
  }),
  [Channels.autofillRemove]: handle([isFieldSection, isAutofillId], (c, section, id) => (c.isPrivate ? refused : autofill().remove(section, id))),
  [Channels.autofillRevealCard]: handle([isAutofillId], (c, id) => (c.isPrivate ? refused : autofill().revealCard(c, id))),
  [Channels.autofillSuggestions]: handle([str], (c, tabId) => autofill().suggestions(c, tabId)),
  [Channels.autofillFill]: handle([str, isAutofillId], (c, tabId, id) => autofill().fill(c, tabId, id)),
  [Channels.autofillPrompt]: handle([isAutofillId], (c, captureId) => autofill().prompt(c, captureId)),
  [Channels.autofillAnswer]: handle([isAutofillId, isAutofillAnswer], (c, captureId, answer) => autofill().answer(c, captureId, answer)),
});

/** Spell checking (ADR-041): the profile's dictionary, never changed from a private window. */
export const spellcheckHandlers = defineHandlers({
  [Channels.spellcheckLanguages]: handleUi([], () => ({ available: spellcheck().available(), current: spellcheck().current() })),
  [Channels.spellcheckWords]: handle([], (c) => (c.isPrivate ? [] : spellcheck().words())),
  [Channels.spellcheckAddWord]: handle([isDictionaryWord], (c, word) => {
    if (!c.isPrivate) spellcheck().addWord(word);
  }),
  [Channels.spellcheckRemoveWord]: handle([isDictionaryWord], (c, word) => {
    if (!c.isPrivate) spellcheck().removeWord(word);
  }),
});
