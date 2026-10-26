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
}

export interface LayoutSettings {
  sidebarPosition: SidebarPosition;
  /** px */
  sidebarWidth: number;
  /** Margin around the page view, in px (0 = edge to edge). */
  gutter: number;
  /** Distraction-free: sidebar hidden until the window edge is hovered, page edge to edge. */
  zenMode: boolean;
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
}

export interface PrivacySettings {
  /** Send the most common `Accept-Language` ("en-US,en") instead of the browser's own languages (ADR-014). */
  normalizeAcceptLanguage: boolean;
}

export interface Settings {
  appearance: AppearanceSettings;
  layout: LayoutSettings;
  search: SearchSettings;
  startPage: StartPageSettings;
  behavior: BehaviorSettings;
  privacy: PrivacySettings;
}

export type SettingsSection = keyof Settings;
export type SettingsPatch = { [S in SettingsSection]?: Partial<Settings[S]> };

export const LIMITS = {
  radius: { min: 0, max: 18 },
  sidebarWidth: { min: 200, max: 420 },
  gutter: { min: 0, max: 16 },
  greetingName: 40,
  url: 2048,
} as const;

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
  },
  layout: { sidebarPosition: "left", sidebarWidth: 264, gutter: 8, zenMode: false },
  search: { engine: DEFAULT_SEARCH_ENGINE.id },
  startPage: { showClock: true, showTopSites: true, greetingName: "", background: "theme", backgroundImage: "" },
  behavior: { restoreSession: true, newTabPosition: "end", closeTabActivates: "next", sleepTabsAfter: "30m" },
  privacy: { normalizeAcceptLanguage: false },
};

export const SETTINGS_SECTIONS = Object.keys(DEFAULT_SETTINGS) as SettingsSection[];

// --- Validation -------------------------------------------------------------------------------

/** A field validator returns the cleaned value, or undefined to keep the previous one. */
type Field<T> = (value: unknown) => T | undefined;
type Schema = { [S in SettingsSection]: { [K in keyof Settings[S]]-?: Field<Settings[S][K]> } };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const oneOf =
  <T extends string>(...values: T[]): Field<T> =>
  (value) =>
    values.includes(value as T) ? (value as T) : undefined;

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
  },
  layout: {
    sidebarPosition: oneOf("left", "right"),
    sidebarWidth: integer(LIMITS.sidebarWidth),
    gutter: integer(LIMITS.gutter),
    zenMode: bool,
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
  },
  privacy: { normalizeAcceptLanguage: bool },
};

/**
 * Validates anything (stored JSON, an IPC patch…) into complete settings: every invalid or
 * missing field falls back to its value in `base`, unknown fields are dropped.
 */
export function sanitizeSettings(value: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const root = isRecord(value) ? value : {};
  const result = {} as Record<string, Record<string, unknown>>;
  for (const section of SETTINGS_SECTIONS) {
    const input = isRecord(root[section]) ? root[section] : {};
    const fields = schema[section] as Record<string, Field<unknown>>;
    const fallback = base[section] as unknown as Record<string, unknown>;
    result[section] = {};
    for (const key of Object.keys(fields)) result[section][key] = fields[key](input[key]) ?? fallback[key];
  }
  return result as unknown as Settings;
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
