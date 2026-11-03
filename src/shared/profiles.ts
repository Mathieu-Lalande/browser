/**
 * User profiles (ADR-042): separate folders for settings, history, bookmarks, passwords, sessions,
 * sync and site data. Pure model: the registry kept in `profiles.json` at the root of the app's
 * data folder, validation, paths and the relaunch arguments.
 */

export type ProfileId = string;

/** The first profile ("Personnel") keeps using the root folder: no data moves on upgrade. */
export const DEFAULT_PROFILE_ID: ProfileId = "default";
/** Sub-folder of the root holding every other profile's folder. */
export const PROFILES_FOLDER = "Profiles";
/** Command-line switch choosing the profile of a launch. */
export const PROFILE_SWITCH = "--profile=";
export const MAX_PROFILES = 20;
export const MAX_PROFILE_NAME = 40;

/** Lucide icon names a profile may use (the UI's `Icon` knows each of them). */
export const PROFILE_ICONS = ["circle-user", "briefcase", "graduation-cap", "heart", "gamepad-2", "code", "coffee", "star"] as const;
export type ProfileIcon = (typeof PROFILE_ICONS)[number];

export const PROFILE_COLORS = ["#4f7cff", "#16a34a", "#e11d48", "#f59e0b", "#8b5cf6", "#0891b2", "#64748b"] as const;

export interface ProfileInfo {
  id: ProfileId;
  name: string;
  color: string;
  icon: ProfileIcon;
  createdAt: number;
}

export interface ProfileInput {
  name?: string;
  color?: string;
  icon?: string;
}

export interface ProfilesData {
  profiles: ProfileInfo[];
  /** Opened when the app starts without `--profile=`. */
  lastUsed: ProfileId;
  /** With several profiles, the first window shows the picker (`browser://profiles`). */
  askOnLaunch: boolean;
}

/** What `browser://profiles` shows. */
export interface ProfilesView extends ProfilesData {
  current: ProfileId;
}

export const DEFAULT_PROFILE: ProfileInfo = { id: DEFAULT_PROFILE_ID, name: "Personnel", color: PROFILE_COLORS[0], icon: "circle-user", createdAt: 0 };

export const isProfileId = (value: unknown): value is ProfileId => typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value);
const isColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const isIcon = (value: unknown): value is ProfileIcon => typeof value === "string" && (PROFILE_ICONS as readonly string[]).includes(value);

export function cleanProfileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_PROFILE_NAME);
  return name || null;
}

export const isProfileInput = (value: unknown): value is ProfileInput => {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Record<string, unknown>;
  return (
    (input.name === undefined || typeof input.name === "string") &&
    (input.color === undefined || isColor(input.color)) &&
    (input.icon === undefined || isIcon(input.icon))
  );
};

function sanitizeProfile(value: unknown): ProfileInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  const name = cleanProfileName(p.name);
  if (!isProfileId(p.id) || !name) return null;
  return {
    id: p.id,
    name,
    color: isColor(p.color) ? p.color : PROFILE_COLORS[0],
    icon: isIcon(p.icon) ? p.icon : "circle-user",
    createdAt: typeof p.createdAt === "number" && Number.isFinite(p.createdAt) ? p.createdAt : 0,
  };
}

/** The registry, always holding the default profile first (a missing or broken file is that alone). */
export function sanitizeProfiles(value: unknown): ProfilesData {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const profiles: ProfileInfo[] = [];
  for (const entry of Array.isArray(data.profiles) ? data.profiles : []) {
    const profile = sanitizeProfile(entry);
    if (profile && !profiles.some((other) => other.id === profile.id) && profiles.length < MAX_PROFILES) profiles.push(profile);
  }
  const index = profiles.findIndex((profile) => profile.id === DEFAULT_PROFILE_ID);
  const first = index === -1 ? { ...DEFAULT_PROFILE } : profiles.splice(index, 1)[0];
  profiles.unshift(first);
  const lastUsed = isProfileId(data.lastUsed) && profiles.some((profile) => profile.id === data.lastUsed) ? data.lastUsed : DEFAULT_PROFILE_ID;
  return { profiles, lastUsed, askOnLaunch: data.askOnLaunch === true };
}

/** Path segments of a profile's folder, relative to the root (the default profile is the root). */
export function profileSegments(id: ProfileId): string[] {
  return id === DEFAULT_PROFILE_ID ? [] : [PROFILES_FOLDER, id];
}

/** The profile asked for on the command line (`--profile=<id>`), if any. */
export function profileFromArgs(argv: readonly string[]): ProfileId | null {
  for (const arg of argv) {
    if (arg.startsWith(PROFILE_SWITCH)) {
      const id = arg.slice(PROFILE_SWITCH.length);
      return isProfileId(id) ? id : null;
    }
  }
  return null;
}

/** Which profile a launch opens: the one asked for if it exists, else the last used. */
export function launchProfile(data: ProfilesData, asked: ProfileId | null): ProfileId {
  if (asked && data.profiles.some((profile) => profile.id === asked)) return asked;
  return data.lastUsed;
}

/** Whether the first window shows the profile picker. */
export const shouldPickProfile = (data: ProfilesData, asked: ProfileId | null): boolean => !asked && data.askOnLaunch && data.profiles.length > 1;

/**
 * Arguments of a new instance of the app opened on `id`: Chromium switches are kept, a previous
 * profile switch and links are dropped; unpackaged, the app's entry (first plain argument) stays.
 */
export function relaunchArgs(args: readonly string[], packaged: boolean, id: ProfileId): string[] {
  let entryKept = packaged;
  const kept = args.filter((arg) => {
    if (arg.startsWith(PROFILE_SWITCH)) return false;
    if (arg.startsWith("-")) return true;
    if (!entryKept) {
      entryKept = true;
      return true;
    }
    return false;
  });
  return [...kept, `${PROFILE_SWITCH}${id}`];
}

/** A new profile id, from its name and a random suffix. */
export function newProfileId(name: string, random: () => string): ProfileId {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `${slug || "profil"}-${random().replace(/[^a-z0-9]/g, "").slice(0, 6) || "1"}`;
}
