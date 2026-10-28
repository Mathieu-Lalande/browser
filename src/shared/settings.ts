import { isReservedAnywhere, needsModifier, normalizeAccelerator, parseAccelerator } from "./accelerators";
import { isCommandId, type ShortcutOverrides } from "./commands";
import { sanitizeSiteList } from "./site-info";
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES, type SearchEngine } from "./url";

/** User preferences, persisted as `settings.json` and applied live in every window. */

export type ThemeMode = "system" | "light" | "dark";
export type BackgroundStyle = "gradient" | "solid" | "mesh";
export type Density = "compact" | "comfortable" | "spacious";
export type UiFont = "system" | "rounded" | "serif" | "mono";
export type SidebarPosition = "left" | "right";
export type NewTabPosition = "end" | "next";
/** Which tab becomes active when the active one is closed. */
export type CloseTabActivates = "next" | "previous" | "recent";
export type StartBackground = "theme" | "aurora" | "image";
/** Idle time after which a background tab is put to sleep (its page unloaded), or never. */
export type TabSleepDelay = "never" | "15m" | "30m" | "1h" | "2h";
/** Idle time after which a tab is closed and kept in the archive (ADR-022), or never. */
export type TabArchiveDelay = "never" | "12h" | "24h" | "7d" | "30d";

export interface AppearanceSettings {
  mode: ThemeMode;
  /** `#rrggbb`. */
  accent: string;
  /** Second color of gradients, `#rrggbb`. */
  accent2: string;
  background: BackgroundStyle;
  density: Density;
  /** Corner radius of the chrome and the page, in px. */
  radius: number;
  font: UiFont;
  shadows: boolean;
  reduceMotion: boolean;
  /** Hand cursor over everything clickable (false: the arrow everywhere, like a native app). */
  pointerCursor: boolean;
  /** Zoom of web pages never zoomed by hand, in % (one of `PAGE_ZOOM_LEVELS`). */
  pageZoom: number;
}

export interface LayoutSettings {
  sidebarPosition: SidebarPosition;
  /** px */
  sidebarWidth: number;
  /** Margin around the page view, in px (0 = edge to edge). */
  gutter: number;
  /** Distraction-free: sidebar hidden until the window edge is hovered, page edge to edge. */
  zenMode: boolean;
  /** The empty favorites grid's drop-zone hint was dismissed (ADR-022). */
  favoritesHintDismissed: boolean;
}

export interface SearchSettings {
  /** Id of one of `SEARCH_ENGINES`. */
  engine: string;
}

export interface StartPageSettings {
  showClock: boolean;
  showTopSites: boolean;
  /** "Bonjour, <name>." — empty for a plain greeting. */
  greetingName: string;
  background: StartBackground;
  /** https: image URL, used when `background` is "image". */
  backgroundImage: string;
}

export interface BehaviorSettings {
  restoreSession: boolean;
  newTabPosition: NewTabPosition;
  closeTabActivates: CloseTabActivates;
  /** Background tabs inactive for this long are put to sleep (ADR-014). */
  sleepTabsAfter: TabSleepDelay;
  /** Tabs inactive for this long are archived: closed, listed in `browser://archive` (ADR-022). */
  archiveTabsAfter: TabArchiveDelay;
}

export interface PrivacySettings {
  /** Send the most common `Accept-Language` ("en-US,en") instead of the browser's own languages (ADR-014). */
  normalizeAcceptLanguage: boolean;
  /**
   * Strip cookies from requests to other sites than the page's, and the cookies they set
   * (ADR-021). Off by default: it breaks some sign-ins and embedded content.
   */
  blockThirdPartyCookies: boolean;
  /** Sites (registrable domains) where third-party cookies stay allowed. */
  thirdPartyCookieExceptions: string[];
}

export interface DownloadSettings {
  /** Absolute path of the folder downloads go to; empty for the OS Downloads folder. */
  folder: string;
  /** Show a save dialog for every download instead of saving to `folder`. */
  askWhere: boolean;
}

/** Reader mode (ADR-026): shared by the desktop and the phone. */
export type ReaderFont = "serif" | "sans";
export type ReaderWidth = "narrow" | "medium" | "wide";
/** "auto" follows the app's theme. */
export type ReaderTheme = "auto" | "sepia" | "dark";

export interface ReaderSettings {
  font: ReaderFont;
  /** Text size, in px (`LIMITS.readerSize`). */
  size: number;
  /** Line length (desktop; the phone uses the screen width). */
  width: ReaderWidth;
  theme: ReaderTheme;
}

export interface Settings {
  appearance: AppearanceSettings;
  layout: LayoutSettings;
  search: SearchSettings;
  startPage: StartPageSettings;
  behavior: BehaviorSettings;
  privacy: PrivacySettings;
  downloads: DownloadSettings;
  reader: ReaderSettings;
  /**
   * Keyboard shortcuts chosen by the user (desktop, ADR-028): only the commands that differ from
   * the registry. A patch replaces the whole map.
   */
  shortcuts: ShortcutOverrides;
}

export type SettingsSection = keyof Settings;
export type SettingsPatch = { [S in SettingsSection]?: Partial<Settings[S]> };

export const LIMITS = {
  radius: { min: 0, max: 18 },
  /**
   * 232: the title bar must hold the Windows controls (3×36px), the private badge (icon only) and
   * two buttons at the spacious density. Saved narrower widths are raised by the sanitizer's clamp.
   */
  sidebarWidth: { min: 232, max: 420 },
  gutter: { min: 0, max: 16 },
  greetingName: 40,
  url: 2048,
  path: 4096,
  readerSize: { min: 14, max: 28 },
} as const;

/** Default page zoom choices, in %. */
export const PAGE_ZOOM_LEVELS = [67, 75, 80, 90, 100, 110, 125, 150, 175] as const;

/** Accent pairs offered as swatches (the second color feeds gradients). */
export const ACCENT_PRESETS: readonly { name: string; accent: string; accent2: string }[] = [
  { name: "Lavande", accent: "#8b7bff", accent2: "#d77bff" },
  { name: "Océan", accent: "#3b82f6", accent2: "#22d3ee" },
  { name: "Menthe", accent: "#10b981", accent2: "#a3e635" },
  { name: "Soleil", accent: "#f59e0b", accent2: "#f43f5e" },
  { name: "Corail", accent: "#ff6b6b", accent2: "#ffa94d" },
  { name: "Rose", accent: "#ec4899", accent2: "#8b5cf6" },
  { name: "Ardoise", accent: "#64748b", accent2: "#94a3b8" },
  { name: "Graphite", accent: "#a1a1aa", accent2: "#52525b" },
];

export const DEFAULT_SETTINGS: Settings = {
  appearance: {
    mode: "system",
    accent: "#8b7bff",
    accent2: "#d77bff",
    background: "gradient",
    density: "comfortable",
    radius: 10,
    font: "system",
    shadows: true,
    reduceMotion: false,
    pointerCursor: true,
    pageZoom: 100,
  },
  layout: { sidebarPosition: "left", sidebarWidth: 264, gutter: 8, zenMode: false, favoritesHintDismissed: false },
  search: { engine: DEFAULT_SEARCH_ENGINE.id },
  startPage: { showClock: true, showTopSites: true, greetingName: "", background: "theme", backgroundImage: "" },
  behavior: { restoreSession: true, newTabPosition: "end", closeTabActivates: "next", sleepTabsAfter: "30m", archiveTabsAfter: "7d" },
  privacy: { normalizeAcceptLanguage: false, blockThirdPartyCookies: false, thirdPartyCookieExceptions: [] },
  downloads: { folder: "", askWhere: false },
  reader: { font: "serif", size: 19, width: "medium", theme: "auto" },
  shortcuts: {},
};

export const SETTINGS_SECTIONS = Object.keys(DEFAULT_SETTINGS) as SettingsSection[];

// --- Validation -------------------------------------------------------------------------------

/** A field validator returns the cleaned value, or undefined to keep the previous one. */
type Field<T> = (value: unknown) => T | undefined;
/** Sections made of fixed fields (`shortcuts` is a map, validated by `sanitizeShortcuts`). */
type FieldSection = Exclude<SettingsSection, "shortcuts">;
type Schema = { [S in FieldSection]: { [K in keyof Settings[S]]-?: Field<Settings[S][K]> } };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const oneOf =
  <T extends string>(...values: T[]): Field<T> =>
  (value) =>
    values.includes(value as T) ? (value as T) : undefined;

const oneOfNumbers =
  (values: readonly number[]): Field<number> =>
  (value) =>
    values.includes(value as number) ? (value as number) : undefined;

const bool: Field<boolean> = (value) => (typeof value === "boolean" ? value : undefined);

const integer =
  ({ min, max }: { min: number; max: number }): Field<number> =>
  (value) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : undefined;

/** `#rgb` / `#rrggbb` (any case) → `#rrggbb`. */
export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  return `#${hex.toLowerCase()}`;
}

/** Free text kept as typed (no trimming while typing), without control characters. */
const text =
  (max: number): Field<string> =>
  (value) =>
    // eslint-disable-next-line no-control-regex
    typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : undefined;

/** Empty, or an https: URL (the chrome UI never loads other schemes as images). */
const imageUrl: Field<string> = (value) => {
  if (value === "") return "";
  if (typeof value !== "string" || value.length > LIMITS.url) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
};

/** Empty, or an absolute local path (POSIX, `C:\…` or a UNC `\\server\share` path) without control characters. */
const folderPath: Field<string> = (value) => {
  if (value === "") return "";
  if (typeof value !== "string" || value.length > LIMITS.path) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return /^(\/|[a-z]:[\\/]|\\\\[^\\])/i.test(value) ? value : undefined;
};

const schema: Schema = {
  appearance: {
    mode: oneOf("system", "light", "dark"),
    accent: normalizeHex,
    accent2: normalizeHex,
    background: oneOf("gradient", "solid", "mesh"),
    density: oneOf("compact", "comfortable", "spacious"),
    radius: integer(LIMITS.radius),
    font: oneOf("system", "rounded", "serif", "mono"),
    shadows: bool,
    reduceMotion: bool,
    pointerCursor: bool,
    pageZoom: oneOfNumbers(PAGE_ZOOM_LEVELS),
  },
  layout: {
    sidebarPosition: oneOf("left", "right"),
    sidebarWidth: integer(LIMITS.sidebarWidth),
    gutter: integer(LIMITS.gutter),
    zenMode: bool,
    favoritesHintDismissed: bool,
  },
  search: { engine: oneOf(...SEARCH_ENGINES.map((engine) => engine.id)) },
  startPage: {
    showClock: bool,
    showTopSites: bool,
    greetingName: text(LIMITS.greetingName),
    background: oneOf("theme", "aurora", "image"),
    backgroundImage: imageUrl,
  },
  behavior: {
    restoreSession: bool,
    newTabPosition: oneOf("end", "next"),
    closeTabActivates: oneOf("next", "previous", "recent"),
    sleepTabsAfter: oneOf("never", "15m", "30m", "1h", "2h"),
    archiveTabsAfter: oneOf("never", "12h", "24h", "7d", "30d"),
  },
  privacy: { normalizeAcceptLanguage: bool, blockThirdPartyCookies: bool, thirdPartyCookieExceptions: sanitizeSiteList },
  downloads: { folder: folderPath, askWhere: bool },
  reader: {
    font: oneOf("serif", "sans"),
    size: integer(LIMITS.readerSize),
    width: oneOf("narrow", "medium", "wide"),
    theme: oneOf("auto", "sepia", "dark"),
  },
};

/**
 * Validates anything (stored JSON, an IPC patch…) into complete settings: every invalid or
 * missing field falls back to its value in `base`, unknown fields are dropped.
 */
export function sanitizeSettings(value: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const root = isRecord(value) ? value : {};
  const result = {} as Record<string, Record<string, unknown>>;
  for (const section of SETTINGS_SECTIONS) {
    if (section === "shortcuts") {
      result.shortcuts = isRecord(root.shortcuts) ? sanitizeShortcuts(root.shortcuts) : { ...base.shortcuts };
      continue;
    }
    const input = isRecord(root[section]) ? root[section] : {};
    const fields = schema[section] as Record<string, Field<unknown>>;
    const fallback = base[section] as unknown as Record<string, unknown>;
    result[section] = {};
    for (const key of Object.keys(fields)) result[section][key] = fields[key](input[key]) ?? fallback[key];
  }
  return result as unknown as Settings;
}

/**
 * Keyboard shortcut overrides (ADR-028): known commands only, accelerators normalized, null for
 * "no shortcut". Dropped: malformed accelerators, keys without Ctrl/Alt/Cmd (except F-keys), keys
 * the OS keeps on some platform, and a second command claiming the same accelerator.
 */
export function sanitizeShortcuts(value: unknown): ShortcutOverrides {
  const result: ShortcutOverrides = {};
  if (!isRecord(value)) return result;
  const taken = new Set<string>();
  for (const [id, accelerator] of Object.entries(value)) {
    if (!isCommandId(id)) continue;
    if (accelerator === null) {
      result[id] = null;
      continue;
    }
    const normalized = normalizeAccelerator(accelerator);
    const parsed = normalized && parseAccelerator(normalized);
    if (!normalized || !parsed || needsModifier(parsed) || isReservedAnywhere(normalized) || taken.has(normalized)) continue;
    taken.add(normalized);
    result[id] = normalized;
  }
  return result;
}

/** Applies a (validated) partial update. */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  return sanitizeSettings(patch, base);
}

/** Back to defaults: one section, or everything. */
export function resetSettings(settings: Settings, section?: SettingsSection): Settings {
  const defaults = structuredClone(DEFAULT_SETTINGS);
  return section ? { ...settings, [section]: defaults[section] } : defaults;
}

export const isSettingsSection = (value: unknown): value is SettingsSection =>
  SETTINGS_SECTIONS.includes(value as SettingsSection);

export function sameSettings(a: Settings, b: Settings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- Derived values ---------------------------------------------------------------------------

export function searchEngineOf(settings: Settings): SearchEngine {
  return SEARCH_ENGINES.find((engine) => engine.id === settings.search.engine) ?? DEFAULT_SEARCH_ENGINE;
}

/** Margin around the page: zen mode is always edge to edge. */
export function effectiveGutter(settings: Settings): number {
  return settings.layout.zenMode ? 0 : settings.layout.gutter;
}

/** Corner radius of the page view: square when it touches the window edges. */
export function pageRadius(settings: Settings): number {
  return effectiveGutter(settings) === 0 ? 0 : settings.appearance.radius;
}

const SLEEP_DELAYS_MS: Record<TabSleepDelay, number | null> = {
  never: null,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 120 * 60_000,
};

/** Idle time before a background tab sleeps, in ms; null when tabs never sleep. */
export function tabSleepDelayMs(settings: Settings): number | null {
  return SLEEP_DELAYS_MS[settings.behavior.sleepTabsAfter];
}

const HOUR_MS = 60 * 60_000;
const ARCHIVE_DELAYS_MS: Record<TabArchiveDelay, number | null> = {
  never: null,
  "12h": 12 * HOUR_MS,
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
};

/** Choices of "Archiver les onglets inactifs après", in order, with their French labels. */
export const ARCHIVE_DELAY_OPTIONS: readonly { value: TabArchiveDelay; label: string }[] = [
  { value: "never", label: "Jamais" },
  { value: "12h", label: "12 h" },
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" },
];

/** Idle time before a tab is archived, in ms; null when tabs are never archived. */
export function tabArchiveDelayMs(settings: Settings): number | null {
  return ARCHIVE_DELAYS_MS[settings.behavior.archiveTabsAfter];
}
