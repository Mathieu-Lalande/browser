import { cleanText } from "./types";

/** Firefox files: `profiles.ini` (profile list). `places.sqlite` is read by main (SQLite). */

export interface FirefoxProfileEntry {
  name: string;
  /** Relative to the Firefox folder when `relative`, else absolute. */
  path: string;
  relative: boolean;
  isDefault: boolean;
}

/** The `[ProfileN]` sections of `profiles.ini`, the default profile first. */
export function parseProfilesIni(text: string): FirefoxProfileEntry[] {
  const profiles: FirefoxProfileEntry[] = [];
  let current: Record<string, string> | null = null;
  const flush = () => {
    if (current?.Path) {
      profiles.push({ name: cleanText(current.Name) || current.Path, path: current.Path, relative: current.IsRelative !== "0", isDefault: current.Default === "1" });
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      flush();
      current = /^Profile\d+$/i.test(section[1]) ? {} : null;
      continue;
    }
    const eq = line.indexOf("=");
    if (current && eq > 0) current[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  flush();
  return profiles.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** Firefox's µs since 1970 → ms (0 when absent). */
export function firefoxTime(value: unknown): number {
  const micros = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(micros) && micros > 0 ? Math.floor(micros / 1000) : 0;
}

/** French names of the Firefox bookmark roots (by GUID); null: never imported (tags). */
export const FIREFOX_ROOTS: Readonly<Record<string, string | null>> = {
  toolbar_____: "Barre personnelle",
  menu________: "Menu des marque-pages",
  unfiled_____: "Autres marque-pages",
  mobile______: "Marque-pages mobiles",
  tags________: null,
};
