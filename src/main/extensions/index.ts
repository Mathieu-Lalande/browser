import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { app, dialog, type BaseWindow, type OpenDialogOptions, type Session } from "electron";
import { isSafeRelativePath, validateManifest, type ExtensionInfo, type ExtensionInstallResult } from "@shared/extensions";
import { JsonFile } from "../storage/json-file";
import { EXTENSIONS_VERSION, ExtensionStore, toInfo, type ExtensionRecord } from "./store";
import { UnpackError, unpackExtension } from "./unpack";

/**
 * Browser extensions (ADR-024), through Electron's own `session.extensions`. Every tab session
 * (default space, isolated spaces, private windows) registers here when it is hardened; the
 * browser UI lives in its own in-memory session (`ui-session.ts`) and never gets any. A private
 * window's session only gets extensions allowed there — and Electron refuses in-memory sessions
 * for now, so in practice none (see the ADR).
 */

const MAX_PACKED_SIZE = 100 * 1024 * 1024;
const MAX_ICON_SIZE = 64 * 1024;
const ICON_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/** Marks an extension being loaded into a session (Electron's id not known yet). */
const PENDING = "";

interface SessionState {
  ephemeral: boolean;
  /** Our extension id → Electron's id in this session (or PENDING). */
  loaded: Map<string, string>;
}

const sessions = new Map<Session, SessionState>();
/** Last load error per extension (French), shown on `browser://extensions`. */
const errors = new Map<string, string>();
let notify: () => void = () => {};
let state: { store: ExtensionStore; file: JsonFile<ExtensionRecord[]>; dir: string } | null = null;

function opened(): NonNullable<typeof state> {
  if (state) return state;
  const profileDir = app.getPath("userData");
  const file = new JsonFile<ExtensionRecord[]>({
    path: join(profileDir, "extensions.json"),
    version: EXTENSIONS_VERSION,
    parse: (data) => ExtensionStore.parse(data),
  });
  state = { store: new ExtensionStore(file.load() ?? []), file, dir: join(profileDir, "extensions") };
  return state;
}

function save(): void {
  const { store, file } = opened();
  file.save(store.toJSON());
}

/** Called whenever the list or an extension's state changed (windows re-list it). */
export function setExtensionsNotifier(listener: () => void): void {
  notify = listener;
}

const shouldLoad = (record: ExtensionRecord | undefined, session: SessionState) =>
  !!record && record.enabled && (!session.ephemeral || record.allowPrivate);

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/** Loads one extension into one session if it belongs there; resolves to an error message, if any. */
async function loadInto(ses: Session, session: SessionState, record: ExtensionRecord): Promise<string | null> {
  if (!shouldLoad(record, session) || session.loaded.has(record.id)) return null;
  session.loaded.set(record.id, PENDING);
  try {
    const extension = await ses.extensions.loadExtension(record.path);
    // Disabled, removed or unloaded while it was loading: undo.
    if (session.loaded.get(record.id) !== PENDING || !shouldLoad(opened().store.get(record.id), session) || !sessions.has(ses)) {
      ses.extensions.removeExtension(extension.id);
      if (session.loaded.get(record.id) === PENDING) session.loaded.delete(record.id);
      return null;
    }
    session.loaded.set(record.id, extension.id);
    return null;
  } catch (error) {
    if (session.loaded.get(record.id) === PENDING) session.loaded.delete(record.id);
    // Private windows' sessions are in memory, which Electron refuses: not the extension's fault.
    if (session.ephemeral) return null;
    return `Le navigateur n'a pas pu charger l'extension : ${describe(error)}`;
  }
}

function unloadFrom(ses: Session, session: SessionState, id: string): void {
  const electronId = session.loaded.get(id);
  session.loaded.delete(id);
  if (electronId) {
    try {
      ses.extensions.removeExtension(electronId);
    } catch {
      // Already gone.
    }
  }
}

/** Brings every session in line with an extension's switches; resolves to the first load error. */
async function apply(id: string): Promise<string | null> {
  const record = opened().store.get(id);
  const results = await Promise.all(
    [...sessions].map(([ses, session]) => {
      if (record && shouldLoad(record, session)) return loadInto(ses, session, record);
      unloadFrom(ses, session, id);
      return null;
    }),
  );
  const error = results.find((result) => result) ?? null;
  if (error) errors.set(id, error);
  else errors.delete(id);
  return error;
}

/**
 * Loads the enabled extensions into a tab session. Idempotent (once per session), like
 * `installDownloads`. `ephemeral`: a private window's session — only extensions allowed in
 * private browsing. Never call it for the browser UI's session.
 */
export function installExtensions(ses: Session, options: { ephemeral?: boolean } = {}): void {
  if (sessions.has(ses)) return;
  const session: SessionState = { ephemeral: options.ephemeral === true, loaded: new Map() };
  sessions.set(ses, session);
  for (const record of opened().store.list()) {
    void loadInto(ses, session, record).then((error) => {
      if (error && errors.get(record.id) !== error) {
        errors.set(record.id, error);
        notify();
      }
    });
  }
}

/** A session going away (private window closed). */
export function forgetExtensionsSession(ses: Session): void {
  sessions.delete(ses);
}

export function listExtensions(): ExtensionInfo[] {
  return opened().store.list().map((record) => toInfo(record, errors.get(record.id)));
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch {
    return undefined;
  }
}

function readIcon(root: string, path: string | null): string | null {
  const type = path && ICON_TYPES[extname(path).toLowerCase()];
  if (!path || !type) return null;
  try {
    const file = join(root, path);
    if (statSync(file).size > MAX_ICON_SIZE) return null;
    return `data:${type};base64,${readFileSync(file).toString("base64")}`;
  } catch {
    return null;
  }
}

/** Chrome-style id: 32 letters a–p (random: ours, not Electron's path-derived one). */
const newId = () => [...randomBytes(16)].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("");

const failure = (message: string): ExtensionInstallResult => ({ ok: false, message });

/** Validates the folder's manifest, records the extension and loads it everywhere it belongs. */
async function installFolder(root: string, id: string, managed: boolean): Promise<ExtensionInstallResult> {
  const { store } = opened();
  if (!existsSync(join(root, "manifest.json"))) return failure("Ce dossier ne contient pas de fichier manifest.json.");
  const raw = readJson(join(root, "manifest.json"));
  if (raw === undefined) return failure("Le fichier manifest.json de l'extension est illisible.");
  const locale = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).default_locale : undefined;
  const messages =
    typeof locale === "string" && isSafeRelativePath(locale) ? readJson(join(root, "_locales", locale, "messages.json")) : undefined;
  const check = validateManifest(raw, typeof messages === "object" && messages !== null ? (messages as Record<string, unknown>) : null);
  if (!check.ok) return check;
  const { manifest } = check;
  if (store.byPath(root)) return failure("Cette extension est déjà installée.");
  if (store.list().some((record) => record.name === manifest.name)) {
    return failure(`Une extension nommée « ${manifest.name} » est déjà installée : retirez-la d'abord pour la remplacer.`);
  }
  if (store.full) return failure("Trop d'extensions installées.");
  const record: ExtensionRecord = {
    id,
    path: root,
    managed,
    enabled: true,
    allowPrivate: false,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    manifestVersion: manifest.manifestVersion,
    icon: readIcon(root, manifest.iconPath),
  };
  store.add(record);
  const error = await apply(id);
  if (error) {
    // Chromium refused it (unsupported key, missing script…): nothing is kept.
    store.remove(id);
    await apply(id);
    errors.delete(id);
    return failure(error);
  }
  save();
  notify();
  return { ok: true, extension: toInfo(record) };
}

async function pick(window: BaseWindow | null, options: OpenDialogOptions): Promise<string | null> {
  const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** "Charger un dossier" : an unpacked extension, used in place (never copied nor deleted). */
export async function installFromFolder(window: BaseWindow | null): Promise<ExtensionInstallResult> {
  const folder = await pick(window, { title: "Choisir le dossier d'une extension", properties: ["openDirectory"] });
  if (!folder) return null;
  return installFolder(resolve(folder), newId(), false);
}

/** "Installer un fichier" : a .zip or .crx, unpacked into `<profile>/extensions/<id>/`. */
export async function installFromFile(window: BaseWindow | null): Promise<ExtensionInstallResult> {
  const file = await pick(window, {
    title: "Choisir une extension (.zip ou .crx)",
    properties: ["openFile"],
    filters: [{ name: "Extensions", extensions: ["zip", "crx"] }],
  });
  if (!file) return null;
  let data: Buffer;
  try {
    if (statSync(file).size > MAX_PACKED_SIZE) return failure("Ce fichier est trop volumineux pour une extension.");
    data = readFileSync(file);
  } catch {
    return failure("Impossible de lire ce fichier.");
  }
  const id = newId();
  const target = join(opened().dir, id);
  try {
    unpackExtension(data, target);
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    return failure(error instanceof UnpackError ? error.message : "Impossible de décompresser l'extension.");
  }
  const result = await installFolder(target, id, true);
  if (!result?.ok) rmSync(target, { recursive: true, force: true });
  return result;
}

async function change(id: string, patch: { enabled?: boolean; allowPrivate?: boolean }): Promise<void> {
  if (!opened().store.update(id, patch)) return;
  save();
  await apply(id);
  notify();
}

export const setExtensionEnabled = (id: string, enabled: boolean) => change(id, { enabled });
export const setExtensionPrivateAllowed = (id: string, allowPrivate: boolean) => change(id, { allowPrivate });

/** Unloads and forgets an extension; a folder the browser unpacked is deleted, a user's folder never. */
export async function removeExtension(id: string): Promise<void> {
  const { store, dir } = opened();
  const record = store.remove(id);
  if (!record) return;
  await apply(id);
  errors.delete(id);
  save();
  if (record.managed && resolve(record.path).startsWith(resolve(dir) + sep)) rmSync(record.path, { recursive: true, force: true });
  notify();
}
