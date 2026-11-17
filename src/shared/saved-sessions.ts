/**
 * Named sessions (ADR-059): "Enregistrer la session" keeps the web pages of the space shown under a
 * name ("Recherche appart", "Sprint 12"); opening it later brings them back in a folder of that
 * name. Pure: the record, its validation and the list edits. Never from a private window.
 */

export const SAVED_SESSIONS_VERSION = 1;
export const MAX_SAVED_SESSIONS = 40;
export const MAX_SESSION_TABS = 200;
export const MAX_SESSION_NAME = 60;
const MAX_TEXT = 300;
const MAX_URL = 2048;

export interface SavedSessionTab {
  url: string;
  title: string;
}

export interface SavedSession {
  id: string;
  name: string;
  createdAt: number;
  tabs: SavedSessionTab[];
}

const isWebUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > MAX_URL) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

export const isSavedSessionId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{4,40}$/.test(value);

export function cleanSessionName(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SESSION_NAME) : "";
}

export function sanitizeSavedSession(value: unknown): SavedSession | null {
  const raw = value as Partial<SavedSession> | null;
  if (!raw || typeof raw !== "object" || !isSavedSessionId(raw.id)) return null;
  const name = cleanSessionName(raw.name);
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs
        .filter((tab): tab is SavedSessionTab => !!tab && isWebUrl(tab.url))
        .slice(0, MAX_SESSION_TABS)
        .map((tab) => ({ url: tab.url, title: typeof tab.title === "string" ? tab.title.slice(0, MAX_TEXT) : "" }))
    : [];
  if (!name || !tabs.length) return null;
  return { id: raw.id, name, createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0, tabs };
}

export function sanitizeSavedSessions(value: unknown): SavedSession[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SavedSession[] = [];
  for (const item of value) {
    const session = sanitizeSavedSession(item);
    if (session && !seen.has(session.id)) {
      seen.add(session.id);
      out.push(session);
    }
  }
  return out.slice(0, MAX_SAVED_SESSIONS);
}

/** The record of the tabs given (web pages only); null when there is nothing to keep or no name. */
export function createSavedSession(id: string, name: string, tabs: readonly { url: string; title: string }[], now: number): SavedSession | null {
  return sanitizeSavedSession({ id, name, createdAt: now, tabs: tabs.map(({ url, title }) => ({ url, title })) });
}

/** Newest first; a session with the same name is replaced; the oldest go past the limit. */
export function addSavedSession(list: readonly SavedSession[], session: SavedSession): SavedSession[] {
  const key = session.name.toLocaleLowerCase();
  return [session, ...list.filter((entry) => entry.name.toLocaleLowerCase() !== key)].slice(0, MAX_SAVED_SESSIONS);
}

export const removeSavedSession = (list: readonly SavedSession[], id: string): SavedSession[] => list.filter((entry) => entry.id !== id);

/** What the page lists: the record without the tab titles beyond the first few. */
export interface SavedSessionSummary {
  id: string;
  name: string;
  createdAt: number;
  count: number;
  /** The first sites, for the card's preview. */
  sites: string[];
}

export function summarizeSession(session: SavedSession): SavedSessionSummary {
  const sites: string[] = [];
  for (const tab of session.tabs) {
    const host = new URL(tab.url).hostname.replace(/^www\./, "");
    if (!sites.includes(host)) sites.push(host);
    if (sites.length === 6) break;
  }
  return { id: session.id, name: session.name, createdAt: session.createdAt, count: session.tabs.length, sites };
}
