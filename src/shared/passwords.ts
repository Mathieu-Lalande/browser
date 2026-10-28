/**
 * Password manager model (ADR-025), shared by the desktop (main process) and the phone. Pure: no
 * Electron, Node or DOM. Storage (encrypted at rest) is each platform's business.
 *
 * Matching: an entry belongs to one exact origin (scheme + host + port). `https://example.com`
 * never fills `https://login.example.com` nor `http://example.com`: no eTLD+1 grouping, which would
 * hand a password to every sub-domain of a site (shared hosting, user pages…). The cost is a
 * second save for a site that logs in on several hosts.
 */

export interface PasswordEntry {
  id: string;
  /** Exact origin, e.g. "https://example.com" (see `passwordOrigin`). */
  origin: string;
  /** May be empty (password-only forms). */
  username: string;
  password: string;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
  /** Last fill; null when never filled. */
  lastUsedAt: number | null;
}

/** What lists show: everything but the password. */
export type PasswordSummary = Omit<PasswordEntry, "password">;

export interface PasswordVault {
  entries: PasswordEntry[];
  /** Origins the user never wants to be asked about ("Jamais pour ce site"). */
  never: string[];
}

/** A login form submission, as captured from a page. */
export interface PasswordCapture {
  origin: string;
  username: string;
  password: string;
}

/** What a capture means for the vault: new entry, new password for a known account, nothing to do. */
export type CaptureOutcome = "new" | "update" | "same" | "never";

export const MAX_ENTRIES = 5000;
export const MAX_NEVER = 1000;
export const MAX_USERNAME = 512;
export const MAX_PASSWORD = 1024;
const MAX_ORIGIN = 512;
const MAX_ID = 64;

export const EMPTY_VAULT: PasswordVault = { entries: [], never: [] };

/** The origin a page's passwords are stored under: http(s) only, null for anything else. */
export function passwordOrigin(url: string): string | null {
  if (typeof url !== "string" || url.length > 8192) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin.length <= MAX_ORIGIN ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Whether `value` is an origin as `passwordOrigin` writes it (validates IPC and stored data). */
export const isPasswordOrigin = (value: unknown): value is string => typeof value === "string" && passwordOrigin(value) === value;

export const isPasswordId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) && value.length <= MAX_ID;

/** Host shown to the user ("example.com", "127.0.0.1:8080"). */
export function originLabel(origin: string): string {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" ? url.host : `${url.host} (http)`;
  } catch {
    return origin;
  }
}

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
// eslint-disable-next-line no-control-regex
const cleanUsername = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, "").trim();

/** A capture from untrusted input (the page's form), or null. */
export function sanitizeCapture(value: unknown): PasswordCapture | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isPasswordOrigin(v.origin) || !isText(v.username, MAX_USERNAME) || !isText(v.password, MAX_PASSWORD) || !v.password) return null;
  return { origin: v.origin, username: cleanUsername(v.username), password: v.password };
}

function sanitizeEntry(value: unknown): PasswordEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isPasswordId(v.id) || !isPasswordOrigin(v.origin) || !isText(v.username, MAX_USERNAME) || !isText(v.password, MAX_PASSWORD) || !v.password) return null;
  if (!isTime(v.createdAt) || !isTime(v.updatedAt)) return null;
  return {
    id: v.id,
    origin: v.origin,
    username: v.username,
    password: v.password,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    lastUsedAt: isTime(v.lastUsedAt) ? v.lastUsedAt : null,
  };
}

/** Validates stored data: bad entries are dropped, duplicates (id, or origin + username) keep the first. */
export function sanitizeVault(value: unknown): PasswordVault {
  if (typeof value !== "object" || value === null) return { entries: [], never: [] };
  const v = value as Record<string, unknown>;
  const entries: PasswordEntry[] = [];
  const ids = new Set<string>();
  const accounts = new Set<string>();
  for (const item of Array.isArray(v.entries) ? v.entries.slice(0, MAX_ENTRIES) : []) {
    const entry = sanitizeEntry(item);
    const account = entry && `${entry.origin}\n${entry.username}`;
    if (!entry || ids.has(entry.id) || accounts.has(account!)) continue;
    ids.add(entry.id);
    accounts.add(account!);
    entries.push(entry);
  }
  const never = [...new Set((Array.isArray(v.never) ? v.never : []).filter(isPasswordOrigin))].slice(0, MAX_NEVER);
  return { entries, never };
}

export const summarize = ({ password: _password, ...summary }: PasswordEntry): PasswordSummary => summary;

/** Entries of one origin, most recently used (or updated) first. */
export function entriesFor(vault: PasswordVault, origin: string): PasswordEntry[] {
  const recency = (entry: PasswordEntry) => Math.max(entry.lastUsedAt ?? 0, entry.updatedAt);
  return vault.entries.filter((entry) => entry.origin === origin).sort((a, b) => recency(b) - recency(a));
}

export const findAccount = (vault: PasswordVault, origin: string, username: string) =>
  vault.entries.find((entry) => entry.origin === origin && entry.username === username);

export function captureOutcome(vault: PasswordVault, capture: PasswordCapture): CaptureOutcome {
  if (vault.never.includes(capture.origin)) return "never";
  const known = findAccount(vault, capture.origin, capture.username);
  if (!known) return "new";
  return known.password === capture.password ? "same" : "update";
}

/**
 * Saves a capture: a new entry, or the new password of the same account (origin + username).
 * `id` is only used for a new entry. Throws when the vault is full.
 */
export function saveCapture(vault: PasswordVault, capture: PasswordCapture, now: number, id: string): PasswordVault {
  const known = findAccount(vault, capture.origin, capture.username);
  if (known) return { ...vault, entries: vault.entries.map((entry) => (entry === known ? { ...entry, password: capture.password, updatedAt: now } : entry)) };
  if (vault.entries.length >= MAX_ENTRIES) throw new Error("Trop de mots de passe enregistrés.");
  const entry: PasswordEntry = { id, ...capture, createdAt: now, updatedAt: now, lastUsedAt: null };
  // Asking to save is also a "yes" to future prompts for the site.
  return { entries: [...vault.entries, entry], never: vault.never.filter((origin) => origin !== capture.origin) };
}

export interface PasswordEdit {
  username?: string;
  password?: string;
}

export function isPasswordEdit(value: unknown): value is PasswordEdit {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.username === undefined || isText(v.username, MAX_USERNAME)) && (v.password === undefined || (isText(v.password, MAX_PASSWORD) && v.password !== ""));
}

/** Edits an entry; a French error message when refused (unknown entry, account already saved). */
export function editEntry(vault: PasswordVault, id: string, edit: PasswordEdit, now: number): { vault: PasswordVault } | { error: string } {
  const entry = vault.entries.find((item) => item.id === id);
  if (!entry) return { error: "Ce mot de passe n'existe plus." };
  const username = edit.username === undefined ? entry.username : cleanUsername(edit.username);
  const password = edit.password ?? entry.password;
  const clash = findAccount(vault, entry.origin, username);
  if (clash && clash.id !== id) return { error: "Un mot de passe est déjà enregistré pour cet identifiant sur ce site." };
  if (username === entry.username && password === entry.password) return { vault };
  return { vault: { ...vault, entries: vault.entries.map((item) => (item.id === id ? { ...item, username, password, updatedAt: now } : item)) } };
}

export const removeEntry = (vault: PasswordVault, id: string): PasswordVault => ({ ...vault, entries: vault.entries.filter((entry) => entry.id !== id) });

export const markUsed = (vault: PasswordVault, id: string, now: number): PasswordVault => ({
  ...vault,
  entries: vault.entries.map((entry) => (entry.id === id ? { ...entry, lastUsedAt: now } : entry)),
});

export function setNever(vault: PasswordVault, origin: string, never: boolean): PasswordVault {
  const others = vault.never.filter((item) => item !== origin);
  return { ...vault, never: never ? [...others, origin].slice(-MAX_NEVER) : others };
}

/** List order and search for `browser://passwords`: site, then username; matches site or username. */
export function searchPasswords<T extends PasswordSummary>(entries: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  return entries
    .filter((entry) => !needle || originLabel(entry.origin).toLowerCase().includes(needle) || entry.username.toLowerCase().includes(needle))
    .sort((a, b) => originLabel(a.origin).localeCompare(originLabel(b.origin)) || a.username.localeCompare(b.username));
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

/**
 * CSV export in the columns Chrome and Firefox import (`name,url,username,password`). Every cell is
 * quoted; values are written as they are (a password is never altered, even one starting with "=").
 */
export function passwordsToCsv(entries: readonly PasswordEntry[]): string {
  const rows = [...entries]
    .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username))
    .map((entry) => [originLabel(entry.origin).replace(/ \(http\)$/, ""), entry.origin, entry.username, entry.password].map(csvCell).join(","));
  return ["name,url,username,password", ...rows].join("\r\n") + "\r\n";
}

// --- What crosses IPC (desktop) ---------------------------------------------------------------

/** Whether passwords can be saved on this device, and why not (French, for the UI). */
export interface PasswordsStatus {
  available: boolean;
  message: string | null;
  /** Saved, but without an OS keychain (Linux "basic" store): said on `browser://passwords`. */
  weak: boolean;
}

export type PasswordResult = { ok: true } | { ok: false; message: string };

/** The save prompt's content: never the password itself. */
export interface PasswordPrompt {
  site: string;
  username: string;
  /** A known account whose password changed ("Mettre à jour"). */
  update: boolean;
}

/** Accounts offered to fill a tab's page (usernames only). */
export interface PasswordAccounts {
  site: string;
  accounts: { id: string; username: string }[];
}

export type PromptAnswer = "save" | "never" | "later";
export const isPromptAnswer = (value: unknown): value is PromptAnswer => value === "save" || value === "never" || value === "later";
