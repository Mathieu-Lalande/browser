import { Channels } from "@shared/ipc";
import { isPasswordEdit, isPasswordId, isPasswordOrigin, isPromptAnswer } from "@shared/passwords";
import {
  accountsFor,
  answerPrompt,
  copyPassword,
  exportPasswords,
  fillPassword,
  listPasswords,
  neverList,
  passwordPrompt,
  removeNever,
  removePassword,
  revealPassword,
  showFillPopover,
  updatePassword,
} from "../passwords";
import { passwordsStatus } from "../passwords/vault";
import { bounds, defineHandlers, handle, handleUi, on, str } from "./registry";

/**
 * Passwords (ADR-025): the UI names entries by id and tabs of its own window; main reads the
 * tab's URL. A password only crosses IPC through `reveal` (the UI confirms first).
 */
export const passwordHandlers = defineHandlers({
  [Channels.passwordsStatus]: handleUi([], () => passwordsStatus()),
  [Channels.passwordsList]: handleUi([], () => listPasswords()),
  [Channels.passwordsNeverList]: handleUi([], () => neverList()),
  [Channels.passwordsReveal]: handle([isPasswordId], (c, entryId) => revealPassword(c, entryId)),
  [Channels.passwordsCopy]: handle([isPasswordId], (c, entryId) => copyPassword(c, entryId)),
  [Channels.passwordsUpdate]: handleUi([isPasswordId, isPasswordEdit], (entryId, edit) => updatePassword(entryId, edit)),
  [Channels.passwordsRemove]: handleUi([isPasswordId], (entryId) => removePassword(entryId)),
  [Channels.passwordsRemoveNever]: handleUi([isPasswordOrigin], (origin) => removeNever(origin)),
  [Channels.passwordsExport]: handle([], (c) => exportPasswords(c)),
  [Channels.passwordsShowFill]: on([bounds], (c, anchor) => showFillPopover(c, anchor)),
  [Channels.passwordsAccounts]: handle([str], (c, tabId) => accountsFor(c, tabId)),
  [Channels.passwordsFill]: handle([str, isPasswordId], (c, tabId, entryId) => fillPassword(c, tabId, entryId)),
  [Channels.passwordsPrompt]: handle([isPasswordId], (c, captureId) => passwordPrompt(c, captureId)),
  [Channels.passwordsAnswer]: handle([isPasswordId, isPromptAnswer], (c, captureId, answer) => answerPrompt(c, captureId, answer)),
});
