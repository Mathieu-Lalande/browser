import { t } from "./i18n";
import { isReservedAnywhere, needsModifier, normalizeAccelerator, parseAccelerator } from "./accelerators";
import { isCommandId, type ShortcutOverrides } from "./commands";
import { sanitizeSiteList } from "./site-info";
import { defaultWidgets, migrateLegacyStartPage, sanitizeWidgets, type StartWidget } from "./start-widgets";
import { normalizeLanguage, sanitizeLanguageList } from "./translate/languages";
import { normalizeServerUrl, type DeepLPlan, type TranslateProviderChoice } from "./translate/providers";
import { sanitizeSiteKeys } from "./translate/rules";
import { ASSISTANT_MODELS, DEFAULT_ASSISTANT_MODEL, type AssistantModelId } from "./assistant/models";
import { SECURE_DNS_CHOICES, normalizeDohTemplate, normalizeNextDnsId, type SecureDnsChoice } from "./secure-dns";
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES, type SearchEngine } from "./url";
import { ENERGY_SAVER_MODES, type EnergySaverMode } from "./energy";

/** User preferences, persisted as `settings.json` and applied live in every window. */

export type ThemeMode = "system" | "light" | "dark";
export type BackgroundStyle = "gradient" | "solid" | "mesh";
export type Density = "compact" | "comfortable" | "spacious";
export type UiFont = "system" | "rounded" | "serif" | "mono";
export type SidebarPosition = "left" | "right";
export type NewTabPosition = "end" | "next";
/** Which tab becomes active when the active one is closed. */
export type CloseTabActivates = "next" | "previous" | "recent";
/** "dynamic": a slowly moving mesh of the accent colors (still when motion is reduced). */
export type StartBackground = "theme" | "aurora" | "dynamic" | "image";
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
  /** The accent follows the site on screen (`theme-color`, else its favicon), ADR-038. */
  dynamicTheme: boolean;
  /** Windows 11: Mica shows through the chrome's backgrounds (ADR-048); no effect elsewhere. */
  mica: boolean;
}

export interface LayoutSettings {
  sidebarPosition: SidebarPosition;
  /** px */
  sidebarWidth: number;
  /** Margin around the page view, in px (0 = edge to edge). */
  gutter: number;
  /** Distraction-free: sidebar hidden until the window edge is hovered, page edge to edge. */
  zenMode: boolean;
  /** The sidebar is a narrow rail of tab icons that unfolds while hovered (ADR-033). */
  compactMode: boolean;
  /** The empty favorites grid's drop-zone hint was dismissed (ADR-022). */
  favoritesHintDismissed: boolean;
  /** Hovering a tab, favorite or rail icon shows a preview card (ADR-038). */
  tabHoverPreview: boolean;
}

export interface SearchSettings {
  /** Id of one of `SEARCH_ENGINES`. */
  engine: string;
}

export interface StartPageSettings {
  /** The new tab page's widgets, in order (ADR-034). */
  widgets: StartWidget[];
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
  /** The start page's one-time "make it the default browser" card was answered (ADR-039). */
  defaultBrowserPromptDismissed: boolean;
  /** Links from other apps open in a mini window (ADR-048) instead of a tab. */
  externalLinksInMiniWindow: boolean;
  /** Energy saver (ADR-048): never, on battery, or always. */
  energySaver: EnergySaverMode;
}

/** Fingerprinting protection (ADR-046). */
export type FingerprintingLevel = "standard" | "strict";
/** "block-sound": media may only autoplay muted; "block-all": nothing plays before the user interacts. */
export type AutoplayPolicy = "allow" | "block-sound" | "block-all";

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
  /**
   * Protected content (Widevine DRM, ADR-040: Netflix, Disney+, Spotify…). On by default; off,
   * pages are refused the DRM key system (and the desktop app does not wait for the CDM at startup).
   */
  protectedContent: boolean;
  /** Cookie banners are refused automatically (ADR-046), except on `cookieBannerExceptions`. */
  cookieBanners: boolean;
  /** Sites (registrable domains) where cookie banners are left alone. */
  cookieBannerExceptions: string[];
  /** DNS over HTTPS (ADR-046): Chromium's choice, a preset provider or a custom template. */
  secureDns: SecureDnsChoice;
  /** `https://…` DoH template used when `secureDns` is "custom" ("" until typed). */
  secureDnsCustomUrl: string;
  /** NextDNS configuration id (optional: without it, NextDNS resolves without filtering). */
  secureDnsNextDnsId: string;
  /** "strict" also denies fingerprinting-prone APIs and high-entropy client hints (ADR-046). */
  fingerprinting: FingerprintingLevel;
  /** Sites where JavaScript is off (a `script-src 'none'` policy added to their documents). */
  javascriptBlockedSites: string[];
  /** Sites whose tabs are muted as soon as they show them. */
  mutedSites: string[];
  /** Default autoplay policy of new tabs (ADR-046). */
  autoplay: AutoplayPolicy;
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

/** Desktop auto-updates (ADR-030). */
export type UpdateChannel = "stable" | "beta";

export interface UpdateSettings {
  /** Download a found update in the background (otherwise: wait for "Télécharger"). */
  autoDownload: boolean;
  /** "beta" also offers pre-releases. */
  channel: UpdateChannel;
}

/**
 * Page translation (ADR-036): off until a provider is chosen (the page's text is sent to it). API
 * keys are not settings: main keeps them in the OS keychain (`safeStorage`), the phone in
 * `expo-secure-store`.
 */
export interface TranslateSettings {
  provider: TranslateProviderChoice;
  deeplPlan: DeepLPlan;
  /** LibreTranslate server (empty: none set). */
  libreUrl: string;
  /** Target language code; empty: the UI/system language. */
  target: string;
  /** Show the address bar button on pages in another language. */
  offer: boolean;
  /** The privacy notice ("le texte de la page est envoyé à …") was accepted. */
  acknowledged: boolean;
  alwaysLanguages: string[];
  neverLanguages: string[];
  /** Hosts without "www." (subdomains included). */
  neverSites: string[];
}

/** The AI assistant (ADR-044): off by default, the user's own Anthropic API key (kept by main). */
export interface AssistantSettings {
  enabled: boolean;
  model: AssistantModelId;
  /** The privacy notice (page text is sent to Anthropic) was accepted. */
  acknowledged: boolean;
  /** Keep a tab's conversation when it goes to another page (still in memory only). */
  keepConversations: boolean;
  /** Questions carry the current page by default. */
  includePage: boolean;
}

/** Notes and highlights (ADR-037). */
export interface AnnotationSettings {
  /** Opt-in: the `annotations` sync collection (end-to-end encrypted like the others). */
  sync: boolean;
}

/** Saved passwords (ADR-050). */
export interface PasswordSettings {
  /** Opt-in: the `passwords` sync collection (end-to-end encrypted, local mirror sealed). */
  sync: boolean;
}

/** Addresses and payment cards (ADR-041). */
export interface AutofillSettings {
  /** Offer to save addresses from submitted forms, and suggest them. */
  addresses: boolean;
  /** Same for payment cards (never their security code). */
  cards: boolean;
  /** Opt-in: the `addresses` sync collection (end-to-end encrypted). Cards are never synced. */
  syncAddresses: boolean;
}

/** Web notifications (ADR-041). */
export interface NotificationSettings {
  /** "Ne pas déranger": notifications of sites are dropped silently. */
  doNotDisturb: boolean;
}

/** Spell checking of text fields (ADR-041). */
export interface SpellcheckSettings {
  enabled: boolean;
  /** Dictionaries (Chromium codes: "fr", "en-US"…); empty: the system language. */
  languages: string[];
}

/**
 * First-run onboarding (`browser://welcome`, ADR-043). The default (`true`) is what a profile from
 * an older version gets: only a fresh profile starts with `false` (`freshProfileSettings`).
 */
export interface OnboardingSettings {
  /** Finished or skipped: the welcome page no longer opens by itself. */
  completed: boolean;
}

/** Crash reports (ADR-043): local only unless the user opts in (and the build has an endpoint). */
/** Media (ADR-047). */
export interface MediaSettings {
  /** Leaving a tab that plays a visible video pops it out in picture-in-picture (back on return). */
  autoPictureInPicture: boolean;
}

/** Web panels (ADR-047). */
export interface PanelSettings {
  /** Opt-in: the panel list travels in the `panels` sync collection. */
  sync: boolean;
}

/** Browser extensions (ADR-049). */
export interface ExtensionSettings {
  /** Check the Chrome Web Store once a day and update the extensions installed from it. */
  autoUpdate: boolean;
}

export interface DiagnosticsSettings {
  /** Opt-in: send crash reports (minidumps) to the build's crash endpoint. */
  crashReports: boolean;
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
  updates: UpdateSettings;
  translate: TranslateSettings;
  assistant: AssistantSettings;
  annotations: AnnotationSettings;
  passwords: PasswordSettings;
  autofill: AutofillSettings;
  notifications: NotificationSettings;
  spellcheck: SpellcheckSettings;
  onboarding: OnboardingSettings;
  diagnostics: DiagnosticsSettings;
  media: MediaSettings;
  panels: PanelSettings;
  extensions: ExtensionSettings;
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
  { get name() { return t("settings.lavender") }, accent: "#8b7bff", accent2: "#d77bff" },
  { get name() { return t("settings.ocean") }, accent: "#3b82f6", accent2: "#22d3ee" },
  { get name() { return t("settings.mint") }, accent: "#10b981", accent2: "#a3e635" },
  { get name() { return t("settings.sun") }, accent: "#f59e0b", accent2: "#f43f5e" },
  { get name() { return t("settings.coral") }, accent: "#ff6b6b", accent2: "#ffa94d" },
  { get name() { return t("settings.pink") }, accent: "#ec4899", accent2: "#8b5cf6" },
  { get name() { return t("settings.slate") }, accent: "#64748b", accent2: "#94a3b8" },
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
    dynamicTheme: false,
    mica: true,
  },
  layout: {
    sidebarPosition: "left",
    sidebarWidth: 264,
    gutter: 8,
    zenMode: false,
    compactMode: false,
    favoritesHintDismissed: false,
    tabHoverPreview: true,
  },
  search: { engine: DEFAULT_SEARCH_ENGINE.id },
  startPage: { widgets: defaultWidgets(), greetingName: "", background: "theme", backgroundImage: "" },
  behavior: {
    restoreSession: true,
    newTabPosition: "end",
    closeTabActivates: "next",
    sleepTabsAfter: "30m",
    archiveTabsAfter: "7d",
    defaultBrowserPromptDismissed: false,
    externalLinksInMiniWindow: true,
    energySaver: "battery",
  },
  privacy: {
    normalizeAcceptLanguage: false,
    blockThirdPartyCookies: false,
    thirdPartyCookieExceptions: [],
    protectedContent: true,
    cookieBanners: true,
    cookieBannerExceptions: [],
    secureDns: "automatic",
    secureDnsCustomUrl: "",
    secureDnsNextDnsId: "",
    fingerprinting: "standard",
    javascriptBlockedSites: [],
    mutedSites: [],
    autoplay: "allow",
  },
  downloads: { folder: "", askWhere: false },
  reader: { font: "serif", size: 19, width: "medium", theme: "auto" },
  updates: { autoDownload: true, channel: "stable" },
  translate: {
    provider: "none",
    deeplPlan: "free",
    libreUrl: "",
    target: "",
    offer: true,
    acknowledged: false,
    alwaysLanguages: [],
    neverLanguages: [],
    neverSites: [],
  },
  assistant: { enabled: false, model: DEFAULT_ASSISTANT_MODEL, acknowledged: false, keepConversations: false, includePage: true },
  annotations: { sync: false },
  passwords: { sync: false },
  autofill: { addresses: true, cards: true, syncAddresses: false },
  notifications: { doNotDisturb: false },
  spellcheck: { enabled: true, languages: [] },
  onboarding: { completed: true },
  diagnostics: { crashReports: false },
  media: { autoPictureInPicture: false },
  panels: { sync: false },
  extensions: { autoUpdate: true },
  shortcuts: {},
};

/** The settings of a brand-new profile: the defaults, with the welcome page still to show (ADR-043). */
export function freshProfileSettings(): Settings {
  return sanitizeSettings({ onboarding: { completed: false } });
}

export const SETTINGS_SECTIONS = Object.keys(DEFAULT_SETTINGS) as SettingsSection[];

/** Spell checker dictionary codes ("fr", "en-US", "pt-BR"), at most 8, without duplicates. */
export const MAX_SPELL_LANGUAGES = 8;
export const isSpellLanguage = (value: unknown): value is string => typeof value === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(value);
function sanitizeSpellLanguages(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter(isSpellLanguage))].slice(0, MAX_SPELL_LANGUAGES);
}

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
    dynamicTheme: bool,
    mica: bool,
  },
  layout: {
    sidebarPosition: oneOf("left", "right"),
    sidebarWidth: integer(LIMITS.sidebarWidth),
    gutter: integer(LIMITS.gutter),
    zenMode: bool,
    compactMode: bool,
    favoritesHintDismissed: bool,
    tabHoverPreview: bool,
  },
  search: { engine: oneOf(...SEARCH_ENGINES.map((engine) => engine.id)) },
  startPage: {
    widgets: sanitizeWidgets,
    greetingName: text(LIMITS.greetingName),
    background: oneOf("theme", "aurora", "dynamic", "image"),
    backgroundImage: imageUrl,
  },
  behavior: {
    restoreSession: bool,
    newTabPosition: oneOf("end", "next"),
    closeTabActivates: oneOf("next", "previous", "recent"),
    sleepTabsAfter: oneOf("never", "15m", "30m", "1h", "2h"),
    archiveTabsAfter: oneOf("never", "12h", "24h", "7d", "30d"),
    defaultBrowserPromptDismissed: bool,
    externalLinksInMiniWindow: bool,
    energySaver: oneOf(...ENERGY_SAVER_MODES),
  },
  privacy: {
    normalizeAcceptLanguage: bool,
    blockThirdPartyCookies: bool,
    thirdPartyCookieExceptions: sanitizeSiteList,
    protectedContent: bool,
    cookieBanners: bool,
    cookieBannerExceptions: sanitizeSiteList,
    secureDns: oneOf(...SECURE_DNS_CHOICES),
    secureDnsCustomUrl: (value) => (value === "" ? "" : (normalizeDohTemplate(value) ?? undefined)),
    secureDnsNextDnsId: (value) => (value === "" ? "" : (normalizeNextDnsId(value) ?? undefined)),
    fingerprinting: oneOf("standard", "strict"),
    javascriptBlockedSites: sanitizeSiteList,
    mutedSites: sanitizeSiteList,
    autoplay: oneOf("allow", "block-sound", "block-all"),
  },
  downloads: { folder: folderPath, askWhere: bool },
  reader: {
    font: oneOf("serif", "sans"),
    size: integer(LIMITS.readerSize),
    width: oneOf("narrow", "medium", "wide"),
    theme: oneOf("auto", "sepia", "dark"),
  },
  updates: { autoDownload: bool, channel: oneOf("stable", "beta") },
  translate: {
    provider: oneOf("none", "deepl", "libretranslate", "google"),
    deeplPlan: oneOf("free", "pro"),
    libreUrl: (value) => (value === "" ? "" : (normalizeServerUrl(value) ?? undefined)),
    target: (value) => (value === "" ? "" : (normalizeLanguage(value) ?? undefined)),
    offer: bool,
    acknowledged: bool,
    alwaysLanguages: sanitizeLanguageList,
    neverLanguages: sanitizeLanguageList,
    neverSites: sanitizeSiteKeys,
  },
  assistant: {
    enabled: bool,
    model: oneOf(...ASSISTANT_MODELS.map((model) => model.id)),
    acknowledged: bool,
    keepConversations: bool,
    includePage: bool,
  },
  annotations: { sync: bool },
  passwords: { sync: bool },
  autofill: { addresses: bool, cards: bool, syncAddresses: bool },
  notifications: { doNotDisturb: bool },
  spellcheck: { enabled: bool, languages: sanitizeSpellLanguages },
  onboarding: { completed: bool },
  diagnostics: { crashReports: bool },
  media: { autoPictureInPicture: bool },
  panels: { sync: bool },
  extensions: { autoUpdate: bool },
};

/**
 * One field through its validator: the cleaned value, or undefined when invalid (strict callers,
 * such as theme import, compare it with the input to refuse rather than fix).
 */
export function validateSettingsField<S extends FieldSection, K extends keyof Settings[S]>(section: S, key: K, value: unknown): Settings[S][K] | undefined {
  const fields = schema[section] as unknown as Record<PropertyKey, Field<Settings[S][K]>>;
  return fields[key]?.(value);
}

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
    let input = isRecord(root[section]) ? root[section] : {};
    if (section === "startPage") {
      const migrated = migrateLegacyStartPage(input);
      if (migrated) input = { ...input, widgets: migrated };
    }
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
  { value: "never", get label() { return t("settings.never") } },
  { value: "12h", label: "12 h" },
  { value: "24h", label: "24 h" },
  { value: "7d", get label() { return t("settings.n7Days") } },
  { value: "30d", get label() { return t("settings.n30Days") } },
];

/** Idle time before a tab is archived, in ms; null when tabs are never archived. */
export function tabArchiveDelayMs(settings: Settings): number | null {
  return ARCHIVE_DELAYS_MS[settings.behavior.archiveTabsAfter];
}
