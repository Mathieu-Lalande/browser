import { randomUUID } from "node:crypto";
import { accessSync, constants, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { app, session, type Session } from "electron";
import { isPrivateProfileName, privateProfileName, privateProfilesBase } from "@shared/private-extensions";
import { forgetFavicons } from "./favicons";
import { hardenSession, releaseSession } from "./security";

/**
 * Private windows' sessions (ADR-014). Each private window gets its own partition without the
 * `persist:` prefix, i.e. kept in memory by Chromium: cookies, storage, cache and HTTP auth never
 * reach the disk, and two private windows do not share them either. It is hardened like every
 * other session, with permission decisions and shields toggles kept to itself (`ephemeral`).
 *
 * Extensions allowed in private browsing (ADR-057): Chromium does not load extensions into
 * in-memory sessions, so a window opened while one is allowed gets a throwaway profile instead —
 * a fresh folder in RAM where possible (`/dev/shm`), else in the temporary folder, wiped and
 * deleted when the window closes, and swept at the next start if the app crashed meanwhile.
 */
const privateSessions = new WeakSet<Session>();
/** Throwaway profile folder of each private session that has one. */
const profileFolders = new Map<Session, string>();

let base: { root: string; inMemory: boolean } | null = null;

function writable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** The folder holding this browser profile's throwaway profiles. */
function profilesRoot(): { root: string; inMemory: boolean } {
  if (base) return base;
  const where = privateProfilesBase(process.platform, app.getPath("temp"), process.platform === "linux" && writable("/dev/shm"), app.getPath("userData"));
  base = { root: join(where.base, where.folder), inMemory: where.inMemory };
  return base;
}

/** `withExtensions`: an extension is allowed in private browsing, the window needs a throwaway profile. */
export function createPrivateSession(withExtensions = false): Session {
  const id = randomUUID();
  let ses: Session | null = null;
  if (withExtensions) {
    const folder = join(profilesRoot().root, privateProfileName(id));
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      ses = session.fromPath(folder, { cache: true });
      profileFolders.set(ses, folder);
    } catch {
      // No writable folder: an in-memory window without extensions, as before.
      ses = null;
    }
  }
  ses ??= session.fromPartition(`private-${id}`, { cache: true });
  privateSessions.add(ses);
  return hardenSession(ses, { ephemeral: true });
}

/**
 * Whether a session belongs to a private window. Profile writers that work per session rather than
 * per window must check it (per-site zoom does). Downloads get the flag from `hardenSession`
 * (`DownloadService.install(ses, { ephemeral })`): the file is saved where the user asked, but its
 * entry is never written to downloads.json.
 */
export function isPrivateSession(ses: Session): boolean {
  return privateSessions.has(ses);
}

/** Whether a private session lives in a throwaway profile (extensions can run there, ADR-057). */
export function hasThrowawayProfile(ses: Session): boolean {
  return profileFolders.has(ses);
}

/** The window closed: everything its pages stored goes away now, not only when the app quits. */
export async function wipePrivateSession(ses: Session): Promise<void> {
  // Every session service lets it go (its downloads are cancelled and leave the list, its extensions unload).
  releaseSession(ses);
  forgetFavicons(ses);
  await Promise.allSettled([ses.clearStorageData(), ses.clearCache(), ses.clearAuthCache(), ses.clearHostResolverCache()]);
  const folder = profileFolders.get(ses);
  if (!folder) return;
  profileFolders.delete(ses);
  // Chromium may still hold a few files open (Windows refuses to delete them): the next start sweeps them.
  remove(folder);
}

function remove(folder: string): void {
  try {
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Kept open by Chromium: swept at the next start.
  }
}

/** At startup: throwaway profiles left behind by a crash (or a file Windows kept open) are deleted. */
export function sweepPrivateProfiles(): void {
  const { root } = profilesRoot();
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return;
  }
  for (const name of names) if (isPrivateProfileName(name)) remove(join(root, name));
}

/** Where the throwaway profiles live in RAM (shown on `browser://extensions`). */
export const privateProfilesInMemory = (): boolean => profilesRoot().inMemory;
