import { t } from "@shared/i18n";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, type Dirent } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { dialog, type BaseWindow, type OpenDialogOptions, type Session } from "electron";
import { Emitter } from "@shared/emitter";
import {
  isSafeRelativePath,
  manifestApiPermissions,
  manifestHosts,
  manifestOptionsPage,
  MAX_DROPPED_FILES,
  MAX_DROPPED_SIZE,
  type DroppedExtension,
  type ExtensionDetailsInfo,
  manifestAction,
  permissionLabels,
  validateManifest,
  type ExtensionInfo,
  type ExtensionInstallResult,
  type ExtensionReview,
  type ExtensionUpdateResult,
  type ManifestAction,
  type ManifestSummary,
} from "@shared/extensions";
import { compareVersions } from "@shared/webstore";
import { storeButtonState, type StoreButtonState, type StoreInstall } from "@shared/webstore-page";
import type { SessionOptions, SessionService } from "../services";
import { JsonFile } from "../storage/json-file";
import type { VerifiedCrx } from "./crx";
import { ExtensionReviews } from "./reviews";
import { EXTENSIONS_VERSION, ExtensionStore, toInfo, type ExtensionDetails, type ExtensionRecord } from "./store";
import { UnpackError, unpackExtension } from "./unpack";
import type { WebStoreClient } from "./webstore";

const MAX_PACKED_SIZE = 100 * 1024 * 1024;
const MAX_ICON_SIZE = 64 * 1024;
const ICON_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

const DAY_MS = 24 * 60 * 60_000;
const UPDATE_TICK_MS = 60 * 60_000;
const FIRST_UPDATE_DELAY_MS = 2 * 60_000;

/** Marks an extension being loaded into a session (Electron's id not known yet). */
const PENDING = "";

interface SessionState {
  ephemeral: boolean;
  /** Our extension id → Electron's id in this session (or PENDING). */
  loaded: Map<string, string>;
}

/** An extension running in a session, as the extension API bridge sees it (ADR-053). */
export interface LoadedExtension {
  /** Our id (`extensions.json`). */
  id: string;
  /** Electron's id in that session: the `chrome-extension://<electronId>/` origin. */
  electronId: string;
  name: string;
  /** Its folder. */
  root: string;
  icon: string | null;
  manifestVersion: 2 | 3;
  manifest: Record<string, unknown>;
}

/** Asks the user to confirm a Web Store install or update (the overlay's permission review, ADR-049). */
export type ExtensionReviewer = (review: ExtensionReview) => Promise<boolean>;

export interface ExtensionServiceOptions {
  /** Chrome Web Store client (ADR-049); absent: store installs and updates are unavailable. */
  webStore?: WebStoreClient;
  /** "Mettre à jour automatiquement" (`settings.extensions.autoUpdate`). */
  autoUpdate?: () => boolean;
}

/** A folder's manifest, once validated, with what the toolbar and the review need. */
interface Inspected {
  manifest: ManifestSummary;
  details: ExtensionDetails;
}

type Failure = { ok: false; message: string };

const shouldLoad = (record: ExtensionRecord | undefined, session: SessionState) =>
  !!record && record.enabled && (!session.ephemeral || record.allowPrivate);

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

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

/** The parsed manifest of a folder, its default locale's messages and its action, or undefined. */
function readFolder(root: string): { raw: Record<string, unknown>; messages: Record<string, unknown> | null; action: ManifestAction | null } | undefined {
  const raw = readJson(join(root, "manifest.json"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const manifest = raw as Record<string, unknown>;
  const locale = manifest.default_locale;
  const messages = typeof locale === "string" && isSafeRelativePath(locale) ? readJson(join(root, "_locales", locale, "messages.json")) : undefined;
  const localized = typeof messages === "object" && messages !== null ? (messages as Record<string, unknown>) : null;
  return { raw: manifest, messages: localized, action: manifestAction(manifest, localized) };
}

/** Validates a folder's manifest; its toolbar button and permission warnings come along. */
function inspect(root: string): Inspected | Failure {
  if (!existsSync(join(root, "manifest.json"))) return { ok: false, message: t("extensionsService.folderHasNoManifest") };
  const folder = readFolder(root);
  if (!folder) return { ok: false, message: t("extensionsService.extensionsManifestJsonFile") };
  const check = validateManifest(folder.raw, folder.messages);
  if (!check.ok) return check;
  const { action } = folder;
  return {
    manifest: check.manifest,
    details: {
      action: action && { title: action.title ?? "", icon: readIcon(root, action.iconPath), hasPopup: !!action.popup && existsSync(join(root, action.popup)) },
      permissions: permissionLabels(folder.raw),
    },
  };
}

const isFailure = (value: Inspected | Failure): value is Failure => "message" in value;

/** Chrome-style id: 32 letters a–p (random: ours, not Electron's path-derived one). */
const newId = () => [...randomBytes(16)].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("");

const failure = (message: string): ExtensionInstallResult => ({ ok: false, message });

async function pick(window: BaseWindow | null, options: OpenDialogOptions): Promise<string | null> {
  const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/**
 * Browser extensions (ADR-024, ADR-049), through Electron's own `session.extensions`. A session
 * service: every tab session (default space, isolated spaces, private windows) gets them when it is
 * hardened; the browser UI lives in its own in-memory session (`ui-session.ts`) and never gets any.
 * A private window's session only gets extensions allowed there — and Electron refuses in-memory
 * sessions, so in practice none (see the ADRs). Store installs and updates: `WebStoreClient`.
 */
export class ExtensionService implements SessionService {
  private readonly sessions = new Map<Session, SessionState>();
  /** Last load error per extension (French), shown on `browser://extensions`. */
  private readonly errors = new Map<string, string>();
  /** Toolbar button and permission warnings per extension, read from the manifests. */
  private readonly details = new Map<string, ExtensionDetails>();
  private readonly changes = new Emitter();
  private state: { store: ExtensionStore; file: JsonFile<ExtensionRecord[]>; dir: string } | null = null;
  /** Permission confirmations waiting for the overlay (ADR-049). */
  readonly reviews = new ExtensionReviews();
  private updating: Promise<ExtensionUpdateResult> | null = null;
  private lastCheck: JsonFile<number> | null = null;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Store installs in progress or failed, by store id (ADR-049). */
  private readonly storeProgress = new Map<string, StoreInstall>();
  /** Parsed manifests by folder (an update unpacks to a new folder). */
  private readonly manifests = new Map<string, Record<string, unknown>>();

  /** `profileDir`: where `extensions.json` and the unpacked extensions (`extensions/`) live. */
  constructor(
    private readonly profileDir: string,
    private readonly options: ExtensionServiceOptions = {},
  ) {}

  /** The local fake store's origin (dev-only test hook), recognized by the UI besides Google's. */
  get webStoreTestOrigin(): string | null {
    return this.options.webStore?.testOrigin ?? null;
  }

  /** The list or an extension's state changed (windows re-list it). */
  onChanged(listener: () => void): () => void {
    return this.changes.on(listener);
  }

  /**
   * Loads the enabled extensions into a tab session. Idempotent (once per session). `ephemeral`: a
   * private window's session — only extensions allowed in private browsing. Never for the browser UI's session.
   */
  install(ses: Session, options: SessionOptions = {}): void {
    if (this.sessions.has(ses)) return;
    const session: SessionState = { ephemeral: options.ephemeral === true, loaded: new Map() };
    this.sessions.set(ses, session);
    for (const record of this.opened().store.list()) {
      void this.loadInto(ses, session, record).then((error) => {
        if (error && this.errors.get(record.id) !== error) {
          this.errors.set(record.id, error);
          this.notify();
        }
      });
    }
  }

  /** A session going away (private window closed). */
  release(ses: Session): void {
    this.sessions.delete(ses);
  }

  dispose(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = null;
  }

  list(): ExtensionInfo[] {
    return this.opened().store.list().map((record) => this.infoOf(record));
  }

  /**
   * The installed, enabled extension Electron knows as `electronId` in `ses`, or null: the sender
   * check of the extension API bridge (ADR-053).
   */
  loaded(ses: Session, electronId: string): LoadedExtension | null {
    const session = this.sessions.get(ses);
    if (!session || !electronId) return null;
    for (const [id, loadedId] of session.loaded) {
      if (loadedId !== electronId) continue;
      const record = this.opened().store.get(id);
      return record && shouldLoad(record, session) ? this.loadedOf(record, electronId) : null;
    }
    return null;
  }

  /** Where an extension runs: each session and Electron's id for it there. */
  placesOf(id: string): { session: Session; electronId: string }[] {
    const places: { session: Session; electronId: string }[] = [];
    for (const [ses, session] of this.sessions) {
      const electronId = session.loaded.get(id);
      if (electronId) places.push({ session: ses, electronId });
    }
    return places;
  }

  /** An enabled extension running somewhere (menus and buttons name it), or null. */
  running(id: string): LoadedExtension | null {
    const place = this.placesOf(id)[0];
    const record = this.opened().store.get(id);
    return place && record?.enabled ? this.loadedOf(record, place.electronId) : null;
  }

  private loadedOf(record: ExtensionRecord, electronId: string): LoadedExtension {
    let manifest = this.manifests.get(record.path);
    if (!manifest) {
      manifest = readFolder(record.path)?.raw ?? {};
      this.manifests.set(record.path, manifest);
    }
    return { id: record.id, electronId, name: record.name, root: record.path, icon: record.icon, manifestVersion: record.manifestVersion, manifest };
  }

  /**
   * The `chrome-extension://` URL of an extension's popup page in `ses`, if it is loaded there and
   * declares one (ADR-049). Electron's id comes from the folder, or from the manifest's `key`.
   */
  popupUrl(ses: Session, id: string, override?: string): string | null {
    const electronId = this.sessions.get(ses)?.loaded.get(id);
    const record = this.opened().store.get(id);
    if (!electronId || !record) return null;
    // `chrome.action.setPopup` (ADR-053): a path inside the extension, "" for none.
    const popup = override !== undefined ? (isSafeRelativePath(override.replace(/^\.?\//, "")) ? override.replace(/^\.?\//, "") : null) : readFolder(record.path)?.action?.popup;
    return popup ? `chrome-extension://${electronId}/${popup.split("/").map(encodeURIComponent).join("/")}` : null;
  }

  /** "Charger un dossier" : an unpacked extension, used in place (never copied nor deleted). */
  async installFromFolder(window: BaseWindow | null): Promise<ExtensionInstallResult> {
    const folder = await pick(window, { title: t("extensionsService.chooseExtensionFolder"), properties: ["openDirectory"] });
    if (!folder) return null;
    return this.installFolder(resolve(folder), newId(), false);
  }

  /** "Installer un fichier" : a .zip or .crx, unpacked into `<profile>/extensions/<id>/`. */
  async installFromFile(window: BaseWindow | null): Promise<ExtensionInstallResult> {
    const file = await pick(window, {
      title: t("extensionsService.chooseExtensionZipCrx"),
      properties: ["openFile"],
      filters: [{ name: t("extensionsService.extensions"), extensions: ["zip", "crx"] }],
    });
    if (!file) return null;
    let data: Buffer;
    try {
      if (statSync(file).size > MAX_PACKED_SIZE) return failure(t("extensionsService.fileTooLargeExtension"));
      data = readFileSync(file);
    } catch {
      return failure(t("extensionsService.cantReadFile"));
    }
    const id = newId();
    const target = join(this.opened().dir, id);
    try {
      unpackExtension(data, target);
    } catch (error) {
      rmSync(target, { recursive: true, force: true });
      return failure(error instanceof UnpackError ? error.message : t("extensionsService.cantUnpackExtension"));
    }
    const result = await this.installFolder(target, id, true);
    if (!result?.ok) rmSync(target, { recursive: true, force: true });
    return result;
  }

  /**
   * "Ajouter à Browser" on a Chrome Web Store page (ADR-049): downloads the package through the
   * update service, checks its CRX3 signature and id, shows its permissions (`review`) and installs
   * it. Null: the user said no.
   */
  async installFromWebStore(webStoreId: string, review: ExtensionReviewer): Promise<ExtensionInstallResult> {
    const webStore = this.options.webStore;
    if (!webStore) return failure(t("extensionsService.installingFromChromeWeb"));
    if (this.opened().store.list().some((record) => record.webStoreId === webStoreId)) return failure(t("extensionsService.extensionAlreadyInstalled"));
    const current = this.storeProgress.get(webStoreId);
    if (current && current.phase !== "error") return null;
    const result = await this.runStoreInstall(webStoreId, webStore, review).catch((): ExtensionInstallResult => failure(t("extensionsService.extensionInstallationFailed")));
    if (result && !result.ok) this.setProgress({ webStoreId, phase: "error", message: result.message });
    else this.setProgress(webStoreId);
    return result;
  }

  /** Store installs in progress, and the last failure of each (ADR-049). */
  storeInstalls(): StoreInstall[] {
    return [...this.storeProgress.values()];
  }

  /** What the button of an extension's store page shows. */
  storeButton(webStoreId: string): StoreButtonState {
    const installed = this.opened().store.list().some((record) => record.webStoreId === webStoreId);
    return storeButtonState(webStoreId, installed, this.storeProgress.get(webStoreId));
  }

  /** The installed extension that came from `webStoreId`, if any. */
  byWebStoreId(webStoreId: string): ExtensionInfo | null {
    const record = this.opened().store.list().find((entry) => entry.webStoreId === webStoreId);
    return record ? this.infoOf(record) : null;
  }

  private setProgress(webStoreId: string, next?: StoreInstall): void;
  private setProgress(next: StoreInstall): void;
  private setProgress(value: string | StoreInstall): void {
    if (typeof value === "string") this.storeProgress.delete(value);
    else this.storeProgress.set(value.webStoreId, value);
    this.notify();
  }

  private async runStoreInstall(webStoreId: string, webStore: WebStoreClient, review: ExtensionReviewer): Promise<ExtensionInstallResult> {
    this.setProgress({ webStoreId, phase: "download" });
    let crx: VerifiedCrx;
    try {
      crx = await webStore.download(webStoreId, () => this.setProgress({ webStoreId, phase: "verify" }));
    } catch (error) {
      return failure(error instanceof UnpackError ? error.message : t("extensionsService.extensionDownloadFailed"));
    }
    const id = newId();
    const target = join(this.opened().dir, id);
    const unpacked = this.unpackStorePackage(crx, target);
    if (isFailure(unpacked)) return unpacked;
    const { manifest, details } = unpacked;
    const duplicate = this.duplicateOf(target, manifest.name);
    let result: ExtensionInstallResult = duplicate ? failure(duplicate) : null;
    if (!duplicate) {
      const icon = readIcon(target, manifest.iconPath);
      this.setProgress({ webStoreId, phase: "review" });
      const accepted = await review({ name: manifest.name, version: manifest.version, icon, permissions: details.permissions, update: false, source: "store" });
      if (accepted) {
        this.setProgress({ webStoreId, phase: "install" });
        result = await this.installFolder(target, id, true, webStoreId);
      }
    }
    if (!result?.ok) rmSync(target, { recursive: true, force: true });
    return result;
  }

  /**
   * A package dropped on `browser://extensions` (a .crx/.zip file or a folder's files): unpacked
   * into the profile, then installed after the same permission review as the store (ADR-049).
   */
  async installDropped(dropped: DroppedExtension, review: ExtensionReviewer): Promise<ExtensionInstallResult> {
    const id = newId();
    const target = join(this.opened().dir, id);
    const discard = (result: ExtensionInstallResult) => {
      rmSync(target, { recursive: true, force: true });
      return result;
    };
    try {
      if (dropped.kind === "file") unpackExtension(Buffer.from(dropped.data), target);
      else writeDroppedFolder(dropped.files, target);
    } catch (error) {
      return discard(failure(error instanceof UnpackError ? error.message : t("extensionsService.cantUnpackExtension")));
    }
    const inspected = inspect(target);
    if (isFailure(inspected)) return discard(inspected);
    const { manifest, details } = inspected;
    const duplicate = this.duplicateOf(target, manifest.name);
    if (duplicate) return discard(failure(duplicate));
    const icon = readIcon(target, manifest.iconPath);
    if (!(await review({ name: manifest.name, version: manifest.version, icon, permissions: details.permissions, update: false, source: "file" }))) return discard(null);
    const result = await this.installFolder(target, id, true);
    if (!result?.ok) return discard(result);
    return result;
  }

  /** "Détails" of `browser://extensions`: sites, permissions, size, options, last update check. */
  detailsOf(id: string): ExtensionDetailsInfo | null {
    const record = this.opened().store.get(id);
    if (!record) return null;
    const raw = readFolder(record.path)?.raw ?? {};
    return {
      id,
      hosts: manifestHosts(raw),
      apiPermissions: manifestApiPermissions(raw),
      size: folderSize(record.path),
      hasOptions: !!optionsPageOf(record.path),
      lastUpdateCheck: record.webStoreId ? (this.lastCheckFile().load() ?? null) : null,
      folder: record.managed ? null : record.path,
    };
  }

  /** The `chrome-extension://` URL of an extension's options page in `ses` (where it is loaded), or null. */
  optionsUrl(ses: Session, id: string): string | null {
    const electronId = this.sessions.get(ses)?.loaded.get(id);
    const record = this.opened().store.get(id);
    const page = record && optionsPageOf(record.path);
    return electronId && page ? `chrome-extension://${electronId}/${page.split("/").map(encodeURIComponent).join("/")}` : null;
  }

  /**
   * "Mettre à jour les extensions" (ADR-049): asks the store for the latest versions of the
   * extensions installed from it and updates them in place. `review`: shown when an update asks for
   * new permissions; without one (daily check), such an update waits for the user.
   */
  checkUpdates(review?: ExtensionReviewer): Promise<ExtensionUpdateResult> {
    this.updating ??= this.runUpdates(review).finally(() => (this.updating = null));
    return this.updating;
  }

  /** The daily automatic check (when `autoUpdate` allows it): a little after startup, then hourly ticks. */
  startAutoUpdates(): void {
    const tick = () => {
      if (!this.options.autoUpdate?.() || !this.opened().store.list().some((record) => record.webStoreId)) return;
      if (Date.now() - (this.lastCheckFile().load() ?? 0) >= DAY_MS) void this.checkUpdates();
    };
    const schedule = (delay: number) => {
      this.updateTimer = setTimeout(() => {
        tick();
        schedule(UPDATE_TICK_MS);
      }, delay);
      this.updateTimer.unref?.();
    };
    schedule(FIRST_UPDATE_DELAY_MS);
  }

  setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.change(id, { enabled });
  }

  setPrivateAllowed(id: string, allowPrivate: boolean): Promise<void> {
    return this.change(id, { allowPrivate });
  }

  /** Pinned: a button in the sidebar's extension row; else only in the puzzle menu (ADR-049). */
  setPinned(id: string, pinned: boolean): Promise<void> {
    return this.change(id, { pinned });
  }

  /** Unloads and forgets an extension; a folder the browser unpacked is deleted, a user's folder never. */
  async remove(id: string): Promise<void> {
    const { store, dir } = this.opened();
    const record = store.remove(id);
    if (!record) return;
    await this.apply(id);
    this.errors.delete(id);
    this.details.delete(id);
    this.save();
    if (record.managed && resolve(record.path).startsWith(resolve(dir) + sep)) rmSync(record.path, { recursive: true, force: true });
    this.notify();
  }

  private notify(): void {
    this.changes.emit();
  }

  private opened(): NonNullable<ExtensionService["state"]> {
    if (this.state) return this.state;
    const file = new JsonFile<ExtensionRecord[]>({
      path: join(this.profileDir, "extensions.json"),
      version: EXTENSIONS_VERSION,
      parse: (data) => ExtensionStore.parse(data),
    });
    this.state = { store: new ExtensionStore(file.load() ?? []), file, dir: join(this.profileDir, "extensions") };
    return this.state;
  }

  private save(): void {
    const { store, file } = this.opened();
    file.save(store.toJSON());
  }

  private lastCheckFile(): JsonFile<number> {
    this.lastCheck ??= new JsonFile<number>({
      path: join(this.profileDir, "extension-updates.json"),
      version: 1,
      parse: (data) => (typeof data === "number" && Number.isFinite(data) ? data : null),
    });
    return this.lastCheck;
  }

  private infoOf(record: ExtensionRecord): ExtensionInfo {
    let details = this.details.get(record.id);
    if (!details) {
      const inspected = inspect(record.path);
      details = isFailure(inspected) ? { action: null, permissions: [] } : inspected.details;
      this.details.set(record.id, details);
    }
    // The button falls back on the extension's own name and icon.
    const action = details.action && { ...details.action, title: details.action.title || record.name, icon: details.action.icon ?? record.icon };
    return toInfo(record, { ...details, action }, this.errors.get(record.id));
  }

  private async change(id: string, patch: { enabled?: boolean; allowPrivate?: boolean; pinned?: boolean }): Promise<void> {
    if (!this.opened().store.update(id, patch)) return;
    this.save();
    await this.apply(id);
    this.notify();
  }

  /** Loads one extension into one session if it belongs there; resolves to an error message, if any. */
  private async loadInto(ses: Session, session: SessionState, record: ExtensionRecord): Promise<string | null> {
    if (!shouldLoad(record, session) || session.loaded.has(record.id)) return null;
    session.loaded.set(record.id, PENDING);
    try {
      const extension = await ses.extensions.loadExtension(record.path);
      // Disabled, removed or unloaded while it was loading: undo.
      if (session.loaded.get(record.id) !== PENDING || !shouldLoad(this.opened().store.get(record.id), session) || !this.sessions.has(ses)) {
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
      return t("extensionsService.browserCouldntLoadExtension", { p: describe(error) });
    }
  }

  private unloadFrom(ses: Session, session: SessionState, id: string): void {
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

  private unloadEverywhere(id: string): void {
    for (const [ses, session] of this.sessions) this.unloadFrom(ses, session, id);
  }

  /** Brings every session in line with an extension's switches; resolves to the first load error. */
  private async apply(id: string): Promise<string | null> {
    const record = this.opened().store.get(id);
    const results = await Promise.all(
      [...this.sessions].map(([ses, session]) => {
        if (record && shouldLoad(record, session)) return this.loadInto(ses, session, record);
        this.unloadFrom(ses, session, id);
        return null;
      }),
    );
    const error = results.find((result) => result) ?? null;
    if (error) this.errors.set(id, error);
    else this.errors.delete(id);
    return error;
  }

  /** Why an extension at `root` named `name` cannot be added, if it cannot. */
  private duplicateOf(root: string, name: string): string | null {
    const { store } = this.opened();
    if (store.byPath(root)) return t("extensionsService.extensionAlreadyInstalled");
    if (store.list().some((record) => record.name === name)) {
      return t("extensionsService.extensionNamedAlreadyInstalled", { name });
    }
    return store.full ? t("extensionsService.tooManyExtensionsInstalled") : null;
  }

  /** Validates the folder's manifest, records the extension and loads it everywhere it belongs. */
  private async installFolder(root: string, id: string, managed: boolean, webStoreId?: string): Promise<ExtensionInstallResult> {
    const inspected = inspect(root);
    if (isFailure(inspected)) return inspected;
    const { manifest, details } = inspected;
    const duplicate = this.duplicateOf(root, manifest.name);
    if (duplicate) return failure(duplicate);
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
      // Chrome-like: a new button waits in the puzzle menu; the install confirmation offers to pin it.
      pinned: false,
      ...(webStoreId ? { webStoreId } : {}),
    };
    const { store } = this.opened();
    store.add(record);
    this.details.set(id, details);
    const error = await this.apply(id);
    if (error) {
      // Chromium refused it (unsupported key, missing script…): nothing is kept.
      store.remove(id);
      this.details.delete(id);
      await this.apply(id);
      this.errors.delete(id);
      return failure(error);
    }
    this.save();
    this.notify();
    return { ok: true, extension: this.infoOf(record) };
  }

  /**
   * Writes a verified store package into `target` and validates it. The developer key goes into the
   * manifest (as Chrome does), so Electron gives the extension its store id.
   */
  private unpackStorePackage(crx: VerifiedCrx, target: string): Inspected | Failure {
    try {
      unpackExtension(crx.zip, target);
      const manifestPath = join(target, "manifest.json");
      const raw = readJson(manifestPath);
      if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && !("key" in raw)) {
        writeFileSync(manifestPath, JSON.stringify({ ...raw, key: crx.publicKey.toString("base64") }, null, 2));
      }
    } catch (error) {
      rmSync(target, { recursive: true, force: true });
      return { ok: false, message: error instanceof UnpackError ? error.message : t("extensionsService.cantUnpackExtension") };
    }
    const inspected = inspect(target);
    if (isFailure(inspected)) rmSync(target, { recursive: true, force: true });
    return inspected;
  }

  private async runUpdates(review?: ExtensionReviewer): Promise<ExtensionUpdateResult> {
    const webStore = this.options.webStore;
    const candidates = this.opened().store.list().filter((record) => record.webStoreId);
    if (!webStore || !candidates.length) return { ok: true, message: t("extensionsService.noExtensionsInstalledFrom") };
    let latest: Map<string, string>;
    try {
      latest = await webStore.latestVersions(candidates.map((record) => ({ id: record.webStoreId!, version: record.version })));
    } catch (error) {
      return { ok: false, message: error instanceof UnpackError ? error.message : t("extensionsService.cantReachChromeWeb") };
    }
    this.lastCheckFile().save(Date.now());
    const updated: string[] = [];
    const problems: string[] = [];
    for (const record of candidates) {
      const version = latest.get(record.webStoreId!);
      if (!version || compareVersions(version, record.version) <= 0) continue;
      const outcome = await this.updateOne(record.id, review);
      if (outcome === true) updated.push(t("extensionsService.text", { name: record.name, p: this.opened().store.get(record.id)?.version ?? version }));
      else if (outcome) problems.push(t("extensionsService.text2", { name: record.name, outcome }));
    }
    this.notify();
    if (!updated.length && !problems.length) return { ok: true, message: t("extensionsService.allExtensionsAreUp") };
    const parts = [...(updated.length ? [t("extensionsService.updated", { p: updated.join(", ") })] : []), ...problems];
    return { ok: !problems.length, message: parts.join(" ") };
  }

  /** Updates one store extension in place: true when done, else a French reason (null: declined or nothing newer). */
  private async updateOne(id: string, review?: ExtensionReviewer): Promise<true | string | null> {
    const { store, dir } = this.opened();
    const old = store.get(id);
    if (!old?.webStoreId || !this.options.webStore) return null;
    let crx: VerifiedCrx;
    try {
      crx = await this.options.webStore.download(old.webStoreId);
    } catch (error) {
      return error instanceof UnpackError ? error.message : t("extensionsService.downloadFailed");
    }
    const target = join(dir, `${id}-${randomBytes(4).toString("hex")}`);
    const unpacked = this.unpackStorePackage(crx, target);
    if (isFailure(unpacked)) return unpacked.message;
    const discard = (reason: string | null) => {
      rmSync(target, { recursive: true, force: true });
      return reason;
    };
    const { manifest, details } = unpacked;
    if (compareVersions(manifest.version, old.version) <= 0) return discard(null);
    const known = new Set(this.details.get(id)?.permissions ?? inspectPermissions(old.path));
    const added = details.permissions.filter((label) => !known.has(label));
    if (added.length) {
      if (!review) {
        const message = t("extensionsService.newVersionAsksMore");
        this.errors.set(id, t("extensionsService.updatePending", { message }));
        return discard(message);
      }
      const icon = readIcon(target, manifest.iconPath);
      if (!(await review({ name: manifest.name, version: manifest.version, icon, permissions: added, update: true }))) return discard(null);
    }
    const next: ExtensionRecord = {
      ...old,
      path: target,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      manifestVersion: manifest.manifestVersion,
      icon: readIcon(target, manifest.iconPath),
    };
    // The old version leaves every session, the new one takes its place.
    this.unloadEverywhere(id);
    store.replace(next);
    this.details.set(id, details);
    const error = await this.apply(id);
    if (error) {
      this.unloadEverywhere(id);
      store.replace(old);
      this.details.delete(id);
      await this.apply(id);
      return discard(error);
    }
    this.save();
    if (old.managed && resolve(old.path).startsWith(resolve(dir) + sep)) rmSync(old.path, { recursive: true, force: true });
    return true;
  }
}

function optionsPageOf(root: string): string | null {
  const page = manifestOptionsPage(readFolder(root)?.raw);
  return page && existsSync(join(root, page)) ? page : null;
}

/** Bytes under a folder (links not followed; bounded walk). */
function folderSize(root: string): number {
  let total = 0;
  let seen = 0;
  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (++seen > 100_000) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        try {
          total += statSync(path).size;
        } catch {
          // Gone meanwhile.
        }
      }
    }
  };
  walk(root);
  return total;
}

/** A dropped folder's files written into `target`, every path checked and the sizes bounded. */
function writeDroppedFolder(files: readonly { path: string; data: Uint8Array }[], target: string): void {
  if (files.length > MAX_DROPPED_FILES) throw new UnpackError(t("extensionsService.folderContainsTooMany"));
  let total = 0;
  // A folder dropped as itself: its files are `<name>/…`; one dropped as its content: `…`.
  const top = files[0]?.path.split("/")[0];
  const prefix = !files.some((file) => file.path === "manifest.json") && top && files.every((file) => file.path.startsWith(`${top}/`)) ? `${top}/` : "";
  if (!files.some((file) => file.path === `${prefix}manifest.json`)) throw new UnpackError(t("extensionsService.folderHasNoManifest"));
  const root = resolve(target);
  for (const file of files) {
    const path = file.path.slice(prefix.length);
    if (!isSafeRelativePath(path)) throw new UnpackError(t("extensionsService.refusedPath", { p: path.slice(0, 80) }));
    total += file.data.length;
    if (total > MAX_DROPPED_SIZE) throw new UnpackError(t("extensionsService.folderTooLargeExtension"));
    const destination = resolve(join(root, path));
    if (!destination.startsWith(root + sep)) throw new UnpackError(t("extensionsService.folderContainsRefusedPath"));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.data);
  }
}

function inspectPermissions(root: string): string[] {
  const inspected = inspect(root);
  return isFailure(inspected) ? [] : inspected.details.permissions;
}
