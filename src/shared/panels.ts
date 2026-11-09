/**
 * Web panels (ADR-047): web apps pinned to the sidebar (WhatsApp Web, Spotify, a mailbox…) that
 * open beside the page, Opera/Vivaldi style. Pure model shared by main, the chrome UI and the sync
 * adapters: validation, list edits, the badge read from a page title, and the synced record.
 */

import { t } from "./i18n";

export const PANELS_VERSION = 1;
export const MAX_PANELS = 16;
export const MAX_PANEL_TITLE = 80;
const MAX_URL = 2048;
/** A panel's favicon, as a `data:` image fetched by main (ADR-018). */
export const MAX_PANEL_FAVICON = 24 * 1024;

/** Width of a panel beside the page, in px. */
export const PANEL_WIDTH = { min: 280, max: 720, default: 380 } as const;

export interface WebPanel {
  id: string;
  /** http(s) only: the page the panel opens (it may navigate within it afterwards). */
  url: string;
  /** The user's name for it (empty: the page's title, then its host). */
  title: string;
  /** The panel asks for the mobile version of the site (narrow layout). */
  mobile: boolean;
  width: number;
  /** `data:` image (never synced: each device fetches its own). */
  favicon: string | null;
  createdAt: number;
}

/** What the chrome UI draws for each panel of a (normal) window. */
export interface PanelView extends WebPanel {
  /** Unread count read from the page's title ("(3) WhatsApp"), while the panel is loaded. */
  badge: number | null;
  /** The panel's page is loaded (it keeps running in the background once opened). */
  loaded: boolean;
}

export interface PanelsState {
  panels: PanelView[];
  /** The panel shown beside the page, if any. */
  openId: string | null;
}

/** What "+" offers before any URL is typed. */
export const PANEL_SUGGESTIONS: readonly { title: string; url: string; mobile: boolean }[] = [
  { title: "WhatsApp", url: "https://web.whatsapp.com/", mobile: false },
  { title: "Messenger", url: "https://www.messenger.com/", mobile: false },
  { title: "Telegram", url: "https://web.telegram.org/", mobile: false },
  { title: "Spotify", url: "https://open.spotify.com/", mobile: false },
  { title: "ChatGPT", url: "https://chatgpt.com/", mobile: false },
  { title: "Claude", url: "https://claude.ai/", mobile: false },
  { title: "Gmail", url: "https://mail.google.com/", mobile: true },
  { get title() { return t("panels.googleCalendar") }, url: "https://calendar.google.com/", mobile: true },
  { title: "Discord", url: "https://discord.com/app", mobile: false },
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
// eslint-disable-next-line no-control-regex
const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");

export const isPanelId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value);

/** http(s) URLs only, with a host: the panel is a web page like a tab's. */
export function isPanelUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_URL) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** What the user typed in "+": a URL, or a bare host ("web.whatsapp.com" → https://…). Null when it is neither. */
export function panelUrlFromInput(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;
  if (!isPanelUrl(candidate)) return null;
  const { hostname } = new URL(candidate);
  return hostname.includes(".") || hostname === "localhost" || /^[\d.]+$/.test(hostname) ? new URL(candidate).href : null;
}

export const clampPanelWidth = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, value))) : PANEL_WIDTH.default;

const isFavicon = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_PANEL_FAVICON && /^data:image\/(png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value);

export function sanitizePanel(value: unknown): WebPanel | null {
  if (!isRecord(value) || !isPanelId(value.id) || !isPanelUrl(value.url)) return null;
  return {
    id: value.id,
    url: value.url,
    title: clean(value.title, MAX_PANEL_TITLE),
    mobile: value.mobile === true,
    width: clampPanelWidth(value.width),
    favicon: isFavicon(value.favicon) ? value.favicon : null,
    createdAt: typeof value.createdAt === "number" && Number.isFinite(value.createdAt) && value.createdAt >= 0 ? Math.floor(value.createdAt) : 0,
  };
}

/** A stored or received list: valid panels, unique ids, at most `MAX_PANELS`. */
export function sanitizePanels(value: unknown): WebPanel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: WebPanel[] = [];
  for (const item of value) {
    const panel = sanitizePanel(item);
    if (!panel || seen.has(panel.id)) continue;
    seen.add(panel.id);
    out.push(panel);
    if (out.length >= MAX_PANELS) break;
  }
  return out;
}

/** The name shown under a panel's icon: its title, else its host. */
export function panelLabel(panel: Pick<WebPanel, "title" | "url">): string {
  if (panel.title) return panel.title;
  try {
    return new URL(panel.url).hostname.replace(/^www\./, "");
  } catch {
    return panel.url;
  }
}

/** The session partition of a panel: its own cookies and storage, kept across restarts. */
export const panelPartition = (id: string) => `persist:panel-${id}`;

export type PanelAddResult = { ok: true; panels: WebPanel[]; panel: WebPanel } | { ok: false; message: string };

/** Adds a panel at the end. Refused: an invalid URL, a full list, or a URL already pinned. */
export function addPanel(
  list: readonly WebPanel[],
  input: { url: string; title?: string; mobile?: boolean },
  id: string,
  now: number,
): PanelAddResult {
  if (!isPanelUrl(input.url)) return { ok: false, message: t("panels.invalidAddressOnlyWeb") };
  if (list.length >= MAX_PANELS) return { ok: false, message: t("panels.panelsMost", { MAX_PANELS }) };
  if (list.some((panel) => samePanelUrl(panel.url, input.url))) return { ok: false, message: t("panels.siteAlreadyPanels") };
  const panel = sanitizePanel({ id, url: input.url, title: input.title ?? "", mobile: input.mobile === true, width: PANEL_WIDTH.default, createdAt: now });
  if (!panel) return { ok: false, message: t("panels.invalidPanel") };
  return { ok: true, panels: [...list, panel], panel };
}

/** Same page, ignoring the fragment and a trailing slash. */
export function samePanelUrl(a: string, b: string): boolean {
  const key = (url: string) => url.split("#")[0].replace(/\/$/, "").toLowerCase();
  return key(a) === key(b);
}

export function removePanel(list: readonly WebPanel[], id: string): WebPanel[] {
  return list.filter((panel) => panel.id !== id);
}

/** Moves a panel to `index` (clamped). Unknown id: the list unchanged. */
export function movePanel(list: readonly WebPanel[], id: string, index: number): WebPanel[] {
  const from = list.findIndex((panel) => panel.id === id);
  if (from < 0) return [...list];
  const next = [...list];
  const [panel] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, Math.round(index))), 0, panel);
  return next;
}

export type PanelPatch = Partial<Pick<WebPanel, "title" | "mobile" | "width" | "favicon">>;

/** Applies a patch through the validator (invalid fields keep their value). */
export function updatePanel(list: readonly WebPanel[], id: string, patch: PanelPatch): WebPanel[] {
  return list.map((panel) => (panel.id === id ? (sanitizePanel({ ...panel, ...patch }) ?? panel) : panel));
}

/**
 * The unread count web apps put in their title: "(3) WhatsApp", "Boîte de réception (12) - …",
 * "Discord | (2) …". Null when there is none (or zero).
 */
export function panelBadge(title: string): number | null {
  const match = /\((\d{1,5})\+?\)/.exec(title);
  if (!match) return null;
  const count = Number(match[1]);
  return count > 0 ? Math.min(count, 999) : null;
}

/** The panel "toggle" (shortcut) shows: the last one opened if it still exists, else the first. */
export function panelToToggle(list: readonly WebPanel[], openId: string | null, lastId: string | null): { open: string | null } {
  if (openId) return { open: null };
  const last = lastId && list.some((panel) => panel.id === lastId) ? lastId : null;
  return { open: last ?? list[0]?.id ?? null };
}

// --- Sync (opt-in, `panels` collection) --------------------------------------------------------

/** What travels: the panel's definition and position. The favicon and the width stay on each device. */
export interface SyncedPanel {
  url: string;
  title: string;
  mobile: boolean;
  position: number;
  createdAt: number;
}

export function panelRecord(panel: WebPanel, position: number): SyncedPanel {
  return { url: panel.url, title: panel.title, mobile: panel.mobile, position, createdAt: panel.createdAt };
}

export function sanitizeSyncedPanel(value: unknown, localId: string): SyncedPanel | null {
  if (!isRecord(value) || !isPanelId(localId)) return null;
  const panel = sanitizePanel({ ...value, id: localId });
  if (!panel) return null;
  const position = typeof value.position === "number" && Number.isFinite(value.position) ? Math.max(0, Math.floor(value.position)) : 0;
  return panelRecord(panel, position);
}

/**
 * Applies synced panels to the local list: deletes, then upserts (a local panel keeps its width and
 * favicon), ordered by the records' positions (local-only panels keep theirs), capped.
 */
export function mergePanels(local: readonly WebPanel[], upserts: readonly { id: string; data: SyncedPanel }[], deletes: readonly string[]): WebPanel[] {
  const positions = new Map<string, number>(local.map((panel, index) => [panel.id, index]));
  let panels = local.filter((panel) => !deletes.includes(panel.id));
  for (const { id, data } of upserts) {
    const existing = panels.find((panel) => panel.id === id);
    const next = sanitizePanel({ ...existing, id, url: data.url, title: data.title, mobile: data.mobile, createdAt: data.createdAt, width: existing?.width, favicon: existing?.favicon });
    if (!next) continue;
    positions.set(id, data.position);
    // Another device pinned the same site under another id: keep one (the synced one).
    panels = panels.filter((panel) => panel.id !== id && !samePanelUrl(panel.url, next.url));
    panels.push(next);
  }
  return panels
    .map((panel, order) => ({ panel, order }))
    .sort((a, b) => (positions.get(a.panel.id) ?? a.order) - (positions.get(b.panel.id) ?? b.order) || a.order - b.order)
    .map(({ panel }) => panel)
    .slice(0, MAX_PANELS);
}
