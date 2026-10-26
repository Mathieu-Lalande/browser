import type { SpaceId, SpaceInfo, SpaceInput } from "./types";

/** Accent colors offered for spaces (the first ones are used, in order, for new spaces). */
export const SPACE_COLORS = ["#8b7bff", "#ff7ba9", "#4fc3a1", "#ffb454", "#5aa9ff", "#e96d5b", "#b48cff", "#9bc53d"] as const;

/** Icons offered for spaces. */
export const SPACE_ICONS = ["🏠", "💼", "🎨", "📚", "🎮", "🛒", "✈️", "🎵", "💡", "🧪", "🌱", "⭐", "🔒", "📰", "🍳", "❤️"] as const;

/** The space every profile starts with (and that v1 sessions are migrated into). */
export const DEFAULT_SPACE: SpaceInfo = { id: "personal", name: "Personnel", icon: "🏠", color: null, isolated: false };

export const MAX_SPACES = 12;
const MAX_NAME = 40;
const MAX_ICON = 16;

/** Space ids end up in session partition names (`persist:space-<id>`): keep them boring. */
export const isSpaceId = (value: unknown): value is SpaceId => typeof value === "string" && /^[\w-]{1,64}$/.test(value);
export const isSpaceColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

const cleanName = (name: string) => name.replace(/[\p{Cc}\s]+/gu, " ").trim().slice(0, MAX_NAME);
const cleanIcon = (icon: string) => icon.replace(/[\p{Cc}\s]/gu, "").slice(0, MAX_ICON);

/** Whether a value is acceptable input for creating/editing a space (unknown fields are refused). */
export function isSpaceInput(value: unknown): value is SpaceInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const known = new Set(["name", "icon", "color", "isolated"]);
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).every((key) => known.has(key)) &&
    (v.name === undefined || (typeof v.name === "string" && v.name.length <= 256)) &&
    (v.icon === undefined || (typeof v.icon === "string" && v.icon.length <= 64)) &&
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
  const icon = typeof s.icon === "string" ? cleanIcon(s.icon) : "";
  return {
    id: s.id,
    name: name || "Espace",
    icon: icon || "⭐",
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
