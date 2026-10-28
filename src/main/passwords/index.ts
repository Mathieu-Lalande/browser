import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, clipboard, dialog, type WebContents } from "electron";
import {
  captureOutcome,
  editEntry,
  entriesFor,
  markUsed,
  originLabel,
  passwordOrigin,
  passwordsToCsv,
  removeEntry,
  sanitizeCapture,
  saveCapture,
  setNever,
  summarize,
  type PasswordAccounts,
  type PasswordCapture,
  type PasswordEdit,
  type PasswordPrompt,
  type PasswordResult,
  type PasswordSummary,
  type PromptAnswer,
} from "@shared/passwords";
import type { Bounds, TabId } from "@shared/types";
import type { BrowserController } from "../window";
import { CAPTURE_SCRIPT, CAPTURE_WORLD_ID, FILL_WORLD_ID, fillScript } from "./scripts";
import { currentVault, hasPasswordsFor, newPasswordId, passwordsStatus, writeVault } from "./vault";

/**
 * Password manager, desktop side (ADR-025): login capture and save prompt, filling, and what
 * `browser://passwords` does. Passwords stay in main: the UI gets usernames and sites, a password
 * only through `revealPassword` (after the user confirmed in the UI); copying and exporting are
 * done here (clipboard, save dialog).
 */

/** Captures waiting for the user's answer in a save prompt, by random id. */
const pending = new Map<string, { capture: PasswordCapture; controller: BrowserController; at: number }>();
const PENDING_TTL = 10 * 60_000;
/** One click on "Se connecter" may also submit the form: one prompt per login. */
const DUPLICATE_MS = 5_000;
let lastCapture: { key: string; at: number } | null = null;

/** Per page, the current watch: a newer one (next document) makes older loops stop. */
const watches = new WeakMap<WebContents, number>();

/**
 * Watches a tab's document for login form submissions (TabManager's `pageReady`, at dom-ready of
 * each document; never wired in private windows). The capture script runs in an isolated world
 * and resolves once per login: this loop handles it and waits for the next one.
 */
export function watchPasswordForms(c: BrowserController, tabId: TabId, contents: WebContents): void {
  const token = (watches.get(contents) ?? 0) + 1;
  watches.set(contents, token);
  void (async () => {
    while (!contents.isDestroyed() && watches.get(contents) === token) {
      let result: unknown;
      try {
        result = await contents.executeJavaScriptInIsolatedWorld(CAPTURE_WORLD_ID, [{ code: CAPTURE_SCRIPT }]);
      } catch {
        return;
      }
      const capture = sanitizeCapture(result);
      // Null: the document went away (the next one gets its own watch).
      if (!capture) return;
      onCapture(c, tabId, capture);
    }
  })();
}

function onCapture(c: BrowserController, tabId: TabId, capture: PasswordCapture): void {
  // Never from a private window (the hook is not even wired there, ADR-014).
  if (c.isPrivate || c.window.isDestroyed() || !passwordsStatus().available) return;
  const outcome = captureOutcome(currentVault(), capture);
  if (outcome === "same" || outcome === "never") return;
  const now = Date.now();
  const key = `${capture.origin}\n${capture.username}\n${capture.password}`;
  if (lastCapture?.key === key && now - lastCapture.at < DUPLICATE_MS) return;
  lastCapture = { key, at: now };
  for (const [id, item] of pending) if (item.controller === c || now - item.at > PENDING_TTL) pending.delete(id);
  // Only for the page on screen: a login in a background tab is not asked about later.
  if (c.tabs.activeTabId !== tabId) return;
  const captureId = newPasswordId();
  pending.set(captureId, { capture, controller: c, at: now });
  const { x, y } = c.tabs.viewBounds;
  c.overlay.open({ kind: "password-save", captureId, anchor: { x: x + 8, y, width: 0, height: 0 } });
}

/** What the save prompt shows (no password). */
export function passwordPrompt(c: BrowserController, captureId: string): PasswordPrompt | null {
  const item = pending.get(captureId);
  if (!item || item.controller !== c) return null;
  return { site: originLabel(item.capture.origin), username: item.capture.username, update: captureOutcome(currentVault(), item.capture) === "update" };
}

export function answerPrompt(c: BrowserController, captureId: string, answer: PromptAnswer): PasswordResult {
  const item = pending.get(captureId);
  if (!item || item.controller !== c) return { ok: false, message: "Cette demande a expiré." };
  pending.delete(captureId);
  lastCapture = null;
  if (answer === "later") return { ok: true };
  const vault = currentVault();
  if (answer === "never") return writeVault(setNever(vault, item.capture.origin, true));
  try {
    return writeVault(saveCapture(vault, item.capture, Date.now(), newPasswordId()));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Le mot de passe n'a pas été enregistré." };
  }
}

/** The tab's live page and its origin, when it can have passwords. */
function pageOf(c: BrowserController, tabId: TabId): { contents: WebContents; origin: string } | null {
  const contents = c.tabs.pageOf(tabId);
  const origin = contents && !contents.isDestroyed() ? passwordOrigin(contents.getURL()) : null;
  return contents && origin ? { contents, origin } : null;
}

export function accountsFor(c: BrowserController, tabId: TabId): PasswordAccounts | null {
  const page = pageOf(c, tabId);
  if (!page) return null;
  return { site: originLabel(page.origin), accounts: entriesFor(currentVault(), page.origin).map(({ id, username }) => ({ id, username })) };
}

/** Fills the tab's login form with entry `id`, which must belong to the page's own origin. */
export async function fillPassword(c: BrowserController, tabId: TabId, id: string): Promise<boolean> {
  const page = pageOf(c, tabId);
  const entry = page && currentVault().entries.find((item) => item.id === id && item.origin === page.origin);
  if (!page || !entry) return false;
  let filled = false;
  try {
    filled = (await page.contents.executeJavaScriptInIsolatedWorld(FILL_WORLD_ID, [{ code: fillScript(entry.origin, entry.username, entry.password) }], true)) === true;
  } catch {
    return false;
  }
  // "Last used" is a profile write: not from a private window.
  if (filled && !c.isPrivate) writeVault(markUsed(currentVault(), entry.id, Date.now()));
  return filled;
}

/** The fill popover (address bar key, menu with several accounts), hanging from `anchor`. */
export function showFillPopover(c: BrowserController, anchor?: Bounds, tabId = c.tabs.activeTabId): void {
  const page = tabId ? pageOf(c, tabId) : null;
  if (!tabId || !page || !hasPasswordsFor(page.origin)) return;
  const { x, y } = c.tabs.viewBounds;
  c.overlay.open({ kind: "password-fill", tabId, anchor: anchor ?? { x: x + 8, y, width: 0, height: 0 } });
}

/** "Remplir le mot de passe" of the page context menu: fills right away when there is one account. */
export function fillFromMenu(c: BrowserController, tabId: TabId): void {
  const accounts = accountsFor(c, tabId)?.accounts ?? [];
  if (accounts.length === 1) void fillPassword(c, tabId, accounts[0].id);
  else if (accounts.length > 1) showFillPopover(c, undefined, tabId);
}

// --- browser://passwords ----------------------------------------------------------------------

export const listPasswords = (): PasswordSummary[] => currentVault().entries.map(summarize);
export const neverList = (): string[] => [...currentVault().never];

export function revealPassword(id: string): string | null {
  return currentVault().entries.find((entry) => entry.id === id)?.password ?? null;
}

const CLIPBOARD_CLEAR_MS = 30_000;

export function copyPassword(id: string): boolean {
  const password = revealPassword(id);
  if (!password) return false;
  clipboard.writeText(password);
  // Not left on the clipboard: cleared after a while, unless something else was copied since.
  setTimeout(async () => {
    if ((await clipboard.readText()) === password) clipboard.clear();
  }, CLIPBOARD_CLEAR_MS).unref();
  return true;
}

export function updatePassword(id: string, edit: PasswordEdit): PasswordResult {
  const result = editEntry(currentVault(), id, edit, Date.now());
  return "error" in result ? { ok: false, message: result.error } : writeVault(result.vault);
}

export function removePassword(id: string): void {
  writeVault(removeEntry(currentVault(), id));
}

export function removeNever(origin: string): void {
  writeVault(setNever(currentVault(), origin, false));
}

/** Writes every password, in clear, to a CSV file the user picks (after a confirmation in the UI). */
export async function exportPasswords(c: BrowserController): Promise<PasswordResult | null> {
  const { entries } = currentVault();
  if (!entries.length) return { ok: false, message: "Aucun mot de passe à exporter." };
  const { canceled, filePath } = await dialog.showSaveDialog(c.window, {
    title: "Exporter les mots de passe",
    defaultPath: join(app.getPath("documents"), "mots-de-passe.csv"),
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (canceled || !filePath) return null;
  try {
    writeFileSync(filePath, passwordsToCsv(entries), { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Windows: the folder's ACLs apply.
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Le fichier n'a pas pu être écrit." };
  }
}
