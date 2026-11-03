import * as nodeFs from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PROFILE_ID,
  MAX_PROFILES,
  PROFILE_COLORS,
  cleanProfileName,
  newProfileId,
  profileSegments,
  relaunchArgs,
  sanitizeProfiles,
  type ProfileId,
  type ProfileIcon,
  type ProfileInfo,
  type ProfileInput,
  type ProfilesData,
  type ProfilesView,
} from "@shared/profiles";
import { writeFileAtomicSync } from "../storage/json-file";

/** The registry file, at the root of the app's data folder. */
export const PROFILES_FILE = "profiles.json";

export type ProfilesFs = Pick<typeof nodeFs, "readFileSync" | "rmSync">;

export interface ProfileLauncher {
  /** Starts another instance of the app with these arguments (one process per open profile). */
  spawn(args: string[]): void;
  /** The current process' arguments (without the executable). */
  args: readonly string[];
  packaged: boolean;
}

/** Reads the registry (a missing or broken file is "Personnel" alone). */
export function readProfiles(root: string, fs: ProfilesFs = nodeFs): ProfilesData {
  try {
    return sanitizeProfiles(JSON.parse(fs.readFileSync(join(root, PROFILES_FILE), "utf8")));
  } catch {
    return sanitizeProfiles(undefined);
  }
}

/** A profile's folder: the root for "Personnel" (the folder of older versions, unchanged), else `Profiles/<id>`. */
export const profileDir = (root: string, id: ProfileId) => join(root, ...profileSegments(id));

/**
 * User profiles (ADR-042). Every profile has its own folder, hence its own settings, history,
 * bookmarks, passwords, session, sync account and site data (Chromium partitions live in the
 * folder too). The main process state is per profile, so each open profile runs in its own app
 * instance: "Ouvrir" starts one with `--profile=<id>` (its single-instance lock is per folder).
 */
export class ProfileService {
  constructor(
    private readonly root: string,
    readonly current: ProfileId,
    private readonly launcher: ProfileLauncher,
    private readonly fs: ProfilesFs = nodeFs,
    private readonly write: (path: string, data: string) => void = writeFileAtomicSync,
    private readonly random: () => string = () => Math.random().toString(36).slice(2),
  ) {}

  view(): ProfilesView {
    return { ...readProfiles(this.root, this.fs), current: this.current };
  }

  /** The open profile's own description. */
  info(): ProfileInfo {
    const data = readProfiles(this.root, this.fs);
    return data.profiles.find((profile) => profile.id === this.current) ?? data.profiles[0];
  }

  /** Remembers this profile as the one to open next time. */
  markUsed(): void {
    this.update((data) => ({ ...data, lastUsed: this.current }));
  }

  create(input: ProfileInput): ProfileInfo | null {
    const name = cleanProfileName(input.name);
    if (!name) return null;
    let created: ProfileInfo | null = null;
    this.update((data) => {
      if (data.profiles.length >= MAX_PROFILES) return data;
      let id = newProfileId(name, this.random);
      while (data.profiles.some((profile) => profile.id === id)) id = newProfileId(name, this.random);
      created = {
        id,
        name,
        color: input.color ?? PROFILE_COLORS[data.profiles.length % PROFILE_COLORS.length],
        icon: (input.icon as ProfileIcon | undefined) ?? "circle-user",
        createdAt: Date.now(),
      };
      return { ...data, profiles: [...data.profiles, created] };
    });
    return created;
  }

  edit(id: ProfileId, input: ProfileInput): boolean {
    let found = false;
    this.update((data) => ({
      ...data,
      profiles: data.profiles.map((profile) => {
        if (profile.id !== id) return profile;
        found = true;
        return {
          ...profile,
          name: cleanProfileName(input.name) ?? profile.name,
          color: input.color ?? profile.color,
          icon: (input.icon as ProfileIcon | undefined) ?? profile.icon,
        };
      }),
    }));
    return found;
  }

  /** Deletes a profile and its folder. Never "Personnel" nor the open profile. */
  remove(id: ProfileId): boolean {
    if (id === DEFAULT_PROFILE_ID || id === this.current) return false;
    const data = readProfiles(this.root, this.fs);
    if (!data.profiles.some((profile) => profile.id === id)) return false;
    this.save({ ...data, profiles: data.profiles.filter((profile) => profile.id !== id), lastUsed: data.lastUsed === id ? this.current : data.lastUsed });
    try {
      this.fs.rmSync(profileDir(this.root, id), { recursive: true, force: true });
    } catch (error) {
      console.warn("[profiles] could not remove the folder:", error);
    }
    return true;
  }

  setAskOnLaunch(ask: boolean): void {
    this.update((data) => ({ ...data, askOnLaunch: ask }));
  }

  /** Opens a profile in a new window (its own instance; an open one just shows a window). */
  open(id: ProfileId): boolean {
    if (!readProfiles(this.root, this.fs).profiles.some((profile) => profile.id === id)) return false;
    this.launcher.spawn(relaunchArgs(this.launcher.args, this.launcher.packaged, id));
    return true;
  }

  private update(change: (data: ProfilesData) => ProfilesData): void {
    this.save(change(readProfiles(this.root, this.fs)));
  }

  private save(data: ProfilesData): void {
    try {
      this.write(join(this.root, PROFILES_FILE), JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn("[profiles] could not save:", error);
    }
  }
}
