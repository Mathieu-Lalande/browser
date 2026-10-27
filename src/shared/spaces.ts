import type { SpaceId, SpaceInfo, SpaceInput } from "./types";

/** Accent colors offered for spaces (the first ones are used, in order, for new spaces). */
export const SPACE_COLORS = ["#8b7bff", "#ff7ba9", "#4fc3a1", "#ffb454", "#5aa9ff", "#e96d5b", "#b48cff", "#9bc53d"] as const;

/**
 * Icons offered for spaces: Lucide icon names (https://lucide.dev), drawn by each UI's Icon
 * component in the theme's text color. Stored by name; anything else is replaced on load.
 */
export const SPACE_ICONS = [
  "circle-user",
  "briefcase",
  "palette",
  "book-open",
  "gamepad-2",
  "shopping-bag",
  "plane",
  "music",
  "lightbulb",
  "flask-conical",
  "sprout",
  "star",
  "lock",
  "newspaper",
  "chef-hat",
  "heart",
  "code",
  "graduation-cap",
  "dumbbell",
  "camera",
  "film",
  "globe",
  "rocket",
  "landmark",
  "wallet",
  "calendar",
  "mail",
  "folder",
  "layers",
  "zap",
  "coffee",
  "users",
] as const;

/** Accessible names of the space icons (French UI). */
export const SPACE_ICON_LABELS: Readonly<Record<(typeof SPACE_ICONS)[number], string>> = {
  "circle-user": "Personnel",
  briefcase: "Travail",
  palette: "Création",
  "book-open": "Lecture",
  "gamepad-2": "Jeux",
  "shopping-bag": "Achats",
  plane: "Voyages",
  music: "Musique",
  lightbulb: "Idées",
  "flask-conical": "Recherche",
  sprout: "Nature",
  star: "Favoris",
  lock: "Privé",
  newspaper: "Actualités",
  "chef-hat": "Cuisine",
  heart: "Santé",
  code: "Développement",
  "graduation-cap": "Études",
  dumbbell: "Sport",
  camera: "Photo",
  film: "Vidéo",
  globe: "Web",
  rocket: "Projets",
  landmark: "Administration",
  wallet: "Finances",
  calendar: "Agenda",
  mail: "Courrier",
  folder: "Dossiers",
  layers: "Divers",
  zap: "Rapide",
  coffee: "Pause",
  users: "Équipe",
};

/** Icon of the ephemeral space of private windows (ADR-014); never offered for regular spaces. */
export const PRIVATE_SPACE_ICON = "venetian-mask";

export type SpaceIcon = (typeof SPACE_ICONS)[number] | typeof PRIVATE_SPACE_ICON;

/** Icon of spaces whose stored icon is unknown. */
export const FALLBACK_SPACE_ICON: SpaceIcon = "star";

const SPACE_ICON_SET: ReadonlySet<string> = new Set(SPACE_ICONS);
export const isSpaceIcon = (value: unknown): value is SpaceIcon => typeof value === "string" && SPACE_ICON_SET.has(value);

/**
 * Emojis that spaces used as icons before Lucide icons (sessions saved by earlier versions, on the
 * desktop and on mobile), keyed without variation selectors.
 */
const EMOJI_SPACE_ICONS: Readonly<Record<string, SpaceIcon>> = {
  "🏠": "circle-user",
  "👤": "circle-user",
  "👥": "users",
  "💼": "briefcase",
  "🎨": "palette",
  "📚": "book-open",
  "📖": "book-open",
  "🎮": "gamepad-2",
  "🛒": "shopping-bag",
  "🛍": "shopping-bag",
  "✈": "plane",
  "🎵": "music",
  "🎶": "music",
  "💡": "lightbulb",
  "🧪": "flask-conical",
  "🌱": "sprout",
  "⭐": "star",
  "🌟": "star",
  "🔒": "lock",
  "📰": "newspaper",
  "🍳": "chef-hat",
  "❤": "heart",
  "💻": "code",
  "🎓": "graduation-cap",
  "🏋": "dumbbell",
  "📷": "camera",
  "📸": "camera",
  "🎬": "film",
  "🌍": "globe",
  "🌎": "globe",
  "🌏": "globe",
  "🚀": "rocket",
  "🏛": "landmark",
  "🏦": "landmark",
  "💰": "wallet",
  "📅": "calendar",
  "📆": "calendar",
  "✉": "mail",
  "📧": "mail",
  "📁": "folder",
  "📂": "folder",
  "⚡": "zap",
  "☕": "coffee",
};

/** A stored icon as a space icon: known names kept, former emojis mapped, anything else the fallback. */
export function migrateSpaceIcon(value: unknown): SpaceIcon {
  if (isSpaceIcon(value)) return value;
  if (typeof value !== "string") return FALLBACK_SPACE_ICON;
  return EMOJI_SPACE_ICONS[value.replace(/[\uFE0E\uFE0F\p{Cc}\s]/gu, "")] ?? FALLBACK_SPACE_ICON;
}

/** The space every profile starts with (and that v1 sessions are migrated into). */
export const DEFAULT_SPACE: SpaceInfo = { id: "personal", name: "Personnel", icon: "circle-user", color: null, isolated: false };

export const MAX_SPACES = 12;
const MAX_NAME = 40;

/** Space ids end up in session partition names (`persist:space-<id>`): keep them boring. */
export const isSpaceId = (value: unknown): value is SpaceId => typeof value === "string" && /^[\w-]{1,64}$/.test(value);
export const isSpaceColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

const cleanName = (name: string) => name.replace(/[\p{Cc}\s]+/gu, " ").trim().slice(0, MAX_NAME);

/** Whether a value is acceptable input for creating/editing a space (unknown fields are refused). */
export function isSpaceInput(value: unknown): value is SpaceInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const known = new Set(["name", "icon", "color", "isolated"]);
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).every((key) => known.has(key)) &&
    (v.name === undefined || (typeof v.name === "string" && v.name.length <= 256)) &&
    (v.icon === undefined || isSpaceIcon(v.icon)) &&
    (v.color === undefined || v.color === null || isSpaceColor(v.color)) &&
    (v.isolated === undefined || typeof v.isolated === "boolean")
  );
}

/** Validates a stored space; null if unusable. */
export function sanitizeSpace(value: unknown): SpaceInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const s = value as Record<string, unknown>;
  if (!isSpaceId(s.id)) return null;
  const name = typeof s.name === "string" ? cleanName(s.name) : "";
  return {
    id: s.id,
    name: name || "Espace",
    icon: migrateSpaceIcon(s.icon),
    color: isSpaceColor(s.color) ? s.color.toLowerCase() : null,
    isolated: s.isolated === true,
  };
}

/** Name, icon and color for the next new space: the first ones not used yet. */
export function nextSpaceDefaults(spaces: readonly SpaceInfo[]): Omit<SpaceInfo, "id"> {
  const names = new Set(spaces.map((space) => space.name));
  let n = spaces.length + 1;
  while (names.has(`Espace ${n}`)) n++;
  const icon = SPACE_ICONS.find((candidate) => !spaces.some((space) => space.icon === candidate)) ?? SPACE_ICONS[0];
  const color = SPACE_COLORS.find((candidate) => !spaces.some((space) => space.color === candidate)) ?? SPACE_COLORS[0];
  return { name: `Espace ${n}`, icon, color, isolated: false };
}

/** Applies validated input to a space. */
export function applySpaceInput(space: SpaceInfo, input: SpaceInput): SpaceInfo {
  return sanitizeSpace({ ...space, ...input, id: space.id }) ?? space;
}

/** Adds a space (defaults filled in), or returns null when the limit is reached. */
export function addSpace(spaces: readonly SpaceInfo[], id: SpaceId, input: SpaceInput = {}): SpaceInfo[] | null {
  if (spaces.length >= MAX_SPACES || spaces.some((space) => space.id === id)) return null;
  const space = applySpaceInput({ id, ...nextSpaceDefaults(spaces) }, input);
  return [...spaces, space];
}

export function updateSpace(spaces: readonly SpaceInfo[], id: SpaceId, input: SpaceInput): SpaceInfo[] {
  return spaces.map((space) => (space.id === id ? applySpaceInput(space, input) : space));
}

/** Removes a space; the last one cannot be removed (returns the list unchanged). */
export function removeSpace(spaces: readonly SpaceInfo[], id: SpaceId): SpaceInfo[] {
  if (spaces.length <= 1) return [...spaces];
  return spaces.filter((space) => space.id !== id);
}

/** The space to show instead of `id` once it is removed: the next one, else the previous one. */
export function neighborSpace(spaces: readonly SpaceInfo[], id: SpaceId): SpaceId | null {
  const index = spaces.findIndex((space) => space.id === id);
  if (index === -1) return spaces[0]?.id ?? null;
  return (spaces[index + 1] ?? spaces[index - 1])?.id ?? null;
}

/** The space `delta` positions away from `id`, wrapping around. */
export function cycleSpace(spaces: readonly SpaceInfo[], id: SpaceId, delta: number): SpaceId | null {
  if (!spaces.length) return null;
  const index = Math.max(0, spaces.findIndex((space) => space.id === id));
  return spaces[(((index + delta) % spaces.length) + spaces.length) % spaces.length].id;
}

/** Session partition of an isolated space (persistent: logins survive restarts). */
export const spacePartition = (id: SpaceId) => `persist:space-${id}`;
