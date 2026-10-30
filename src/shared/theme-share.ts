import {
  DEFAULT_SETTINGS,
  validateSettingsField,
  type AppearanceSettings,
  type Settings,
  type SettingsPatch,
  type StartBackground,
} from "./settings";
import { fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from "./sync/bytes";

/**
 * Shareable themes (ADR-030): the look of the browser as a compact, versioned string
 * (`browser-theme:v1:<base64url JSON>`) or a `.browsertheme` JSON file, shared by the desktop and
 * the phone. Decoding is strict: every field goes through the settings validators and must come
 * out unchanged, unknown fields are refused, sizes are bounded. A theme carries no URL nor image
 * (the start page's image is never exported). Pure: no DOM, no Node.
 */

export const THEME_CODE_PREFIX = "browser-theme:v1:";
export const THEME_FILE_FORMAT = "browser-theme";
export const THEME_FILE_EXTENSION = ".browsertheme";
export const THEME_VERSION = 1;
/** Longest accepted code (a full theme encodes to ~250 characters). */
export const MAX_THEME_CODE = 1024;
/** Largest accepted `.browsertheme` file, in characters. */
export const MAX_THEME_FILE = 4096;
export const MAX_THEME_NAME = 40;

type ThemeAppearance = Pick<AppearanceSettings, "mode" | "accent" | "accent2" | "background" | "density" | "radius" | "font" | "shadows">;

export interface SharedTheme extends ThemeAppearance {
  /** Shown on the preview card; may be empty. */
  name: string;
  /** Start page background, "image" excluded (a theme never carries an image or a URL). */
  startBackground: Exclude<StartBackground, "image">;
}

export type ThemeDecodeResult = { ok: true; theme: SharedTheme } | { ok: false; error: string };

const APPEARANCE_KEYS = ["mode", "accent", "accent2", "background", "density", "radius", "font", "shadows"] as const satisfies readonly (keyof ThemeAppearance)[];
const THEME_KEYS = new Set<string>(["name", "startBackground", ...APPEARANCE_KEYS]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// eslint-disable-next-line no-control-regex
const cleanName = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_THEME_NAME);

/** The current look, as a theme (the start image becomes the theme's background). */
export function themeFromSettings(settings: Settings, name = ""): SharedTheme {
  const theme = { name: cleanName(name) } as SharedTheme;
  for (const key of APPEARANCE_KEYS) (theme as unknown as Record<string, unknown>)[key] = settings.appearance[key];
  theme.startBackground = settings.startPage.background === "aurora" ? "aurora" : "theme";
  return theme;
}

/** Settings patch applying a (validated) theme. The start background is left alone when it is an image and the theme says "theme". */
export function themePatch(theme: SharedTheme, current?: Settings): SettingsPatch {
  const appearance: Partial<AppearanceSettings> = {};
  for (const key of APPEARANCE_KEYS) (appearance as Record<string, unknown>)[key] = theme[key];
  const keepImage = current?.startPage.background === "image" && theme.startBackground === "theme";
  return keepImage ? { appearance } : { appearance, startPage: { background: theme.startBackground } };
}

/** Settings as they would be with the theme applied (preview cards). */
export function applyTheme(settings: Settings, theme: SharedTheme): Settings {
  const patch = themePatch(theme, settings);
  return {
    ...settings,
    appearance: { ...settings.appearance, ...patch.appearance },
    startPage: { ...settings.startPage, ...patch.startPage },
  };
}

/** True when the settings already show this theme (name ignored). */
export function isCurrentTheme(settings: Settings, theme: SharedTheme): boolean {
  const current = themeFromSettings(settings);
  return APPEARANCE_KEYS.every((key) => current[key] === theme[key]) && current.startBackground === theme.startBackground;
}

/** Strict validation of a decoded object. */
export function validateTheme(value: unknown): ThemeDecodeResult {
  const invalid = (detail: string): ThemeDecodeResult => ({ ok: false, error: `Thème invalide : ${detail}.` });
  if (!isRecord(value)) return invalid("format inattendu");
  for (const key of Object.keys(value)) if (!THEME_KEYS.has(key)) return invalid(`champ inconnu « ${key.slice(0, 24)} »`);
  const theme = {} as Record<string, unknown>;
  for (const key of APPEARANCE_KEYS) {
    const cleaned = validateSettingsField("appearance", key, value[key]);
    if (cleaned === undefined || cleaned !== value[key]) return invalid(`valeur incorrecte pour « ${key} »`);
    theme[key] = cleaned;
  }
  const name = value.name ?? "";
  if (typeof name !== "string" || name.length > MAX_THEME_NAME || cleanName(name) !== name) return invalid("nom incorrect");
  theme.name = name;
  const start = value.startBackground ?? "theme";
  if (start !== "theme" && start !== "aurora") return invalid("valeur incorrecte pour « startBackground »");
  theme.startBackground = start;
  return { ok: true, theme: theme as unknown as SharedTheme };
}

/** Field order is fixed so a theme always encodes to the same code. */
function ordered(theme: SharedTheme): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (theme.name) out.name = theme.name;
  for (const key of APPEARANCE_KEYS) out[key] = theme[key];
  out.startBackground = theme.startBackground;
  return out;
}

/** `browser-theme:v1:<base64url JSON>`. */
export function encodeTheme(theme: SharedTheme): string {
  return THEME_CODE_PREFIX + toBase64Url(utf8Encode(JSON.stringify(ordered(theme))));
}

/** Decodes a theme code (surrounding spaces and line breaks tolerated). */
export function decodeTheme(input: string): ThemeDecodeResult {
  const code = input.replace(/\s+/g, "");
  if (code.length > MAX_THEME_CODE) return { ok: false, error: "Code de thème trop long." };
  const match = /^browser-theme:v(\d+):(.*)$/.exec(code);
  if (!match) return { ok: false, error: "Ce n'est pas un code de thème Browser." };
  if (Number(match[1]) !== THEME_VERSION) return { ok: false, error: "Version de thème non prise en charge : mettez Browser à jour." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(fromBase64Url(match[2])));
  } catch {
    return { ok: false, error: "Code de thème illisible ou incomplet." };
  }
  return validateTheme(parsed);
}

/** Contents of a `.browsertheme` file. */
export function themeFile(theme: SharedTheme): string {
  return `${JSON.stringify({ format: THEME_FILE_FORMAT, version: THEME_VERSION, theme: ordered(theme) }, null, 2)}\n`;
}

/** Parses a `.browsertheme` file. */
export function parseThemeFile(text: string): ThemeDecodeResult {
  if (text.length > MAX_THEME_FILE) return { ok: false, error: "Fichier de thème trop volumineux." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Fichier de thème illisible." };
  }
  if (!isRecord(parsed) || parsed.format !== THEME_FILE_FORMAT) return { ok: false, error: "Ce n'est pas un fichier de thème Browser." };
  if (parsed.version !== THEME_VERSION) return { ok: false, error: "Version de thème non prise en charge : mettez Browser à jour." };
  if (Object.keys(parsed).some((key) => key !== "format" && key !== "version" && key !== "theme")) return { ok: false, error: "Thème invalide : champ inconnu." };
  return validateTheme(parsed.theme);
}

/** Whatever was pasted or read: a code, or a file's contents. */
export function parseThemeInput(text: string): ThemeDecodeResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Collez un code de thème." };
  return trimmed.startsWith("{") ? parseThemeFile(trimmed) : decodeTheme(trimmed);
}

/** File name for an export (`Thème Ardoise.browsertheme` → `theme-ardoise.browsertheme`). */
export function themeFileName(theme: SharedTheme): string {
  const slug = theme.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return `${slug || "theme"}${THEME_FILE_EXTENSION}`;
}

const base = DEFAULT_SETTINGS.appearance;
const preset = (theme: Partial<SharedTheme> & Pick<SharedTheme, "name" | "accent" | "accent2">): SharedTheme => ({
  mode: base.mode,
  background: base.background,
  density: base.density,
  radius: base.radius,
  font: base.font,
  shadows: base.shadows,
  startBackground: "theme",
  ...theme,
});

/** Curated themes offered in the appearance settings (desktop and phone). */
export const THEME_GALLERY: readonly SharedTheme[] = [
  preset({ name: "Browser", accent: base.accent, accent2: base.accent2 }),
  preset({ name: "Graphite", mode: "dark", accent: "#a1a1aa", accent2: "#52525b", background: "solid", radius: 6, density: "compact" }),
  preset({ name: "Papier", mode: "light", accent: "#b45309", accent2: "#78716c", background: "solid", font: "serif", radius: 4, shadows: false }),
  preset({ name: "Nuit polaire", mode: "dark", accent: "#38bdf8", accent2: "#6366f1", background: "mesh", startBackground: "aurora" }),
  preset({ name: "Forêt", accent: "#16a34a", accent2: "#0d9488", background: "mesh", radius: 12, density: "spacious" }),
  preset({ name: "Terminal", mode: "dark", accent: "#22c55e", accent2: "#15803d", background: "solid", font: "mono", radius: 2, density: "compact", shadows: false }),
  preset({ name: "Corail", accent: "#ff6b6b", accent2: "#ffa94d", font: "rounded", radius: 16, startBackground: "aurora" }),
  preset({ name: "Encre", mode: "light", accent: "#1d4ed8", accent2: "#0f172a", background: "solid", radius: 8 }),
];
