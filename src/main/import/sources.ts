import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isProfileFolderName, parseChromiumProfiles } from "@shared/import/chromium";
import { parseProfilesIni } from "@shared/import/firefox";
import { BROWSER_NAMES, type BrowserKind, type ImportSource } from "@shared/import/types";
import { ArcReader, ChromiumProfileReader, FirefoxProfileReader, type ProfileReader } from "./readers";

/** Where a browser keeps its data on this OS. */
export interface BrowserLocation {
  browser: BrowserKind;
  family: "chromium" | "firefox" | "arc";
  /** Chromium: the "User Data" folder (profiles inside, or the profile itself for Opera). Firefox: the folder of `profiles.ini`. Arc: `StorableSidebar.json`. */
  path: string;
}

export interface LocationEnv {
  platform: NodeJS.Platform;
  home: string;
  /** Windows `%LOCALAPPDATA%` and `%APPDATA%`. */
  localAppData?: string;
  appData?: string;
}

/** The usual data folders of each supported browser on `env.platform` (existing or not). */
export function browserLocations(env: LocationEnv): BrowserLocation[] {
  const chromium = (browser: BrowserKind, path: string): BrowserLocation => ({ browser, family: "chromium", path });
  if (env.platform === "win32") {
    const local = env.localAppData ?? join(env.home, "AppData", "Local");
    const roaming = env.appData ?? join(env.home, "AppData", "Roaming");
    return [
      chromium("chrome", join(local, "Google", "Chrome", "User Data")),
      chromium("edge", join(local, "Microsoft", "Edge", "User Data")),
      chromium("brave", join(local, "BraveSoftware", "Brave-Browser", "User Data")),
      chromium("vivaldi", join(local, "Vivaldi", "User Data")),
      chromium("opera", join(roaming, "Opera Software", "Opera Stable")),
      chromium("chromium", join(local, "Chromium", "User Data")),
      { browser: "firefox", family: "firefox", path: join(roaming, "Mozilla", "Firefox") },
      // Arc for Windows is a Store app: its folder name ends with a publisher hash (resolved by `detect`).
      { browser: "arc", family: "arc", path: join(local, "Packages", "TheBrowserCompany.Arc_*", "LocalCache", "Local", "Arc", "StorableSidebar.json") },
    ];
  }
  if (env.platform === "darwin") {
    const support = join(env.home, "Library", "Application Support");
    return [
      chromium("chrome", join(support, "Google", "Chrome")),
      chromium("edge", join(support, "Microsoft Edge")),
      chromium("brave", join(support, "BraveSoftware", "Brave-Browser")),
      chromium("vivaldi", join(support, "Vivaldi")),
      chromium("opera", join(support, "com.operasoftware.Opera")),
      chromium("chromium", join(support, "Chromium")),
      { browser: "firefox", family: "firefox", path: join(support, "Firefox") },
      { browser: "arc", family: "arc", path: join(support, "Arc", "StorableSidebar.json") },
    ];
  }
  const config = join(env.home, ".config");
  return [
    chromium("chrome", join(config, "google-chrome")),
    chromium("edge", join(config, "microsoft-edge")),
    chromium("brave", join(config, "BraveSoftware", "Brave-Browser")),
    chromium("vivaldi", join(config, "vivaldi")),
    chromium("opera", join(config, "opera")),
    chromium("chromium", join(config, "chromium")),
    { browser: "firefox", family: "firefox", path: join(env.home, ".mozilla", "firefox") },
    { browser: "firefox", family: "firefox", path: join(env.home, "snap", "firefox", "common", ".mozilla", "firefox") },
  ];
}

/** A detected source: what the wizard lists, and the readers behind each profile id. */
export interface DetectedSource {
  source: ImportSource;
  readers: Map<string, ProfileReader>;
}

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const readText = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/** `…/Packages/TheBrowserCompany.Arc_*\/…`: the first package folder matching the prefix. */
function expandStar(path: string): string | null {
  const parts = path.split(/[\\/]/);
  const star = parts.findIndex((part) => part.endsWith("*"));
  if (star === -1) return path;
  const parent = parts.slice(0, star).join("/") || "/";
  const prefix = parts[star].slice(0, -1);
  let match: string | undefined;
  try {
    match = readdirSync(parent).find((name) => name.startsWith(prefix));
  } catch {
    return null;
  }
  return match ? join(parent, match, ...parts.slice(star + 1)) : null;
}

/** The profiles of a Chromium "User Data" folder (or the folder itself when it is the profile, like Opera's). */
function chromiumProfiles(userData: string): { dir: string; name: string }[] {
  if (ChromiumProfileReader.isProfile(userData)) return [{ dir: userData, name: "Profil principal" }];
  const named = (() => {
    const text = readText(join(userData, "Local State"));
    if (!text) return new Map<string, string>();
    try {
      return parseChromiumProfiles(JSON.parse(text));
    } catch {
      return new Map<string, string>();
    }
  })();
  let folders: string[] = [];
  try {
    folders = readdirSync(userData).filter((name) => isProfileFolderName(name) && (name === "Default" || /^Profile \d+$/.test(name) || named.has(name)));
  } catch {
    return [];
  }
  return folders
    .map((name) => ({ dir: join(userData, name), name: named.get(name) ?? (name === "Default" ? "Profil principal" : name) }))
    .filter((profile) => ChromiumProfileReader.isProfile(profile.dir))
    .sort((a, b) => Number(b.dir.endsWith("Default")) - Number(a.dir.endsWith("Default")) || a.name.localeCompare(b.name));
}

function firefoxProfiles(root: string): { dir: string; name: string }[] {
  const text = readText(join(root, "profiles.ini"));
  if (!text) return [];
  return parseProfilesIni(text)
    .map((entry) => ({ dir: entry.relative ? resolve(root, entry.path) : entry.path, name: entry.name }))
    .filter((profile) => isAbsolute(profile.dir) && existsSync(join(profile.dir, "places.sqlite")));
}

/**
 * The browsers found on this computer and their profiles. Reads only folder listings and small
 * profile lists (`Local State`, `profiles.ini`): the data itself is read when importing.
 */
export function detectSources(locations: readonly BrowserLocation[], extra: readonly (BrowserLocation & { name: string; id: string })[] = []): DetectedSource[] {
  const found: DetectedSource[] = [];
  const all = [...extra, ...locations.map((location, index) => ({ ...location, name: BROWSER_NAMES[location.browser], id: `${location.browser}-${index}` }))];
  for (const location of all) {
    const readers = new Map<string, ProfileReader>();
    const profiles: ImportSource["profiles"] = [];
    const add = (key: string, name: string, reader: ProfileReader) => {
      if (!reader.items.length) return;
      const id = `${location.id}:${profiles.length}`;
      readers.set(id, reader);
      profiles.push({ id, name: name || key, items: reader.items });
    };
    if (location.family === "chromium" && isDir(location.path)) {
      for (const profile of chromiumProfiles(location.path)) add(profile.dir, profile.name, new ChromiumProfileReader(profile.dir));
    } else if (location.family === "firefox" && isDir(location.path)) {
      for (const profile of firefoxProfiles(location.path)) add(profile.dir, profile.name, new FirefoxProfileReader(profile.dir));
    } else if (location.family === "arc") {
      const file = expandStar(location.path);
      if (file && existsSync(file)) add(file, "Barre latérale", new ArcReader(file));
    }
    if (profiles.length) found.push({ source: { id: location.id, browser: location.browser, name: location.name, profiles }, readers });
  }
  return found;
}
