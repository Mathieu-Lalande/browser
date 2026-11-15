/**
 * Extensions in private windows (ADR-057), pure. Chromium (Electron 44) refuses to load an
 * extension into an in-memory session ("Extensions cannot be loaded in a temporary session"), so a
 * private window opened while at least one enabled extension is allowed there gets a *throwaway
 * profile* instead: a fresh folder, in RAM where the system has one (`/dev/shm` on Linux), else in
 * the temporary folder, deleted when the window closes and swept at the next start after a crash.
 * Without such an extension, private windows keep their in-memory partition (ADR-014).
 */

export interface PrivateExtensionSwitches {
  enabled: boolean;
  allowPrivate: boolean;
}

/** Whether a new private window needs a throwaway profile (an enabled extension is allowed there). */
export const privateWindowNeedsProfile = (extensions: readonly PrivateExtensionSwitches[]): boolean =>
  extensions.some((extension) => extension.enabled && extension.allowPrivate);

/** Whether an extension runs (and shows its button) in a window: private windows only get the allowed ones. */
export const runsInWindow = (extension: PrivateExtensionSwitches, isPrivate: boolean): boolean => extension.enabled && (!isPrivate || extension.allowPrivate);

/** Folder name of one throwaway profile (the window's random id). */
export const privateProfileName = (uuid: string): string => `private-${uuid}`;

/** A folder the sweep may delete: one of ours, never anything else found there. */
export const isPrivateProfileName = (name: string): boolean => /^private-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name);

/** FNV-1a (32 bits) in hex: a short, stable name for the browser profile the throwaway folders belong to. */
export function profileKey(userDataPath: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userDataPath.length; i++) {
    hash ^= userDataPath.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Where the throwaway profiles of one browser profile live: RAM (`/dev/shm`) on Linux when it is
 * writable, else the system's temporary folder. One folder per browser profile, so that the sweep
 * of one running instance never touches another profile's windows (ADR-042: one instance per profile).
 */
export function privateProfilesBase(platform: string, tempDir: string, shmWritable: boolean, userDataPath: string): { base: string; inMemory: boolean; folder: string } {
  const inMemory = platform === "linux" && shmWritable;
  return { base: inMemory ? "/dev/shm" : tempDir, inMemory, folder: `browser-private-${profileKey(userDataPath)}` };
}
