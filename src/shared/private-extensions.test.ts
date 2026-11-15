import { describe, expect, it } from "vitest";
import { isPrivateProfileName, privateProfileName, privateProfilesBase, privateWindowNeedsProfile, profileKey, runsInWindow } from "./private-extensions";

describe("extensions in private windows (ADR-057)", () => {
  it("needs a throwaway profile only for an enabled extension allowed there", () => {
    expect(privateWindowNeedsProfile([])).toBe(false);
    expect(privateWindowNeedsProfile([{ enabled: true, allowPrivate: false }])).toBe(false);
    expect(privateWindowNeedsProfile([{ enabled: false, allowPrivate: true }])).toBe(false);
    expect(privateWindowNeedsProfile([{ enabled: false, allowPrivate: true }, { enabled: true, allowPrivate: true }])).toBe(true);
  });

  it("shows in a private window only the extensions allowed there", () => {
    expect(runsInWindow({ enabled: true, allowPrivate: false }, false)).toBe(true);
    expect(runsInWindow({ enabled: true, allowPrivate: false }, true)).toBe(false);
    expect(runsInWindow({ enabled: true, allowPrivate: true }, true)).toBe(true);
    expect(runsInWindow({ enabled: false, allowPrivate: true }, true)).toBe(false);
  });

  it("names the throwaway folders so that the sweep deletes nothing else", () => {
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    expect(isPrivateProfileName(privateProfileName(uuid))).toBe(true);
    expect(isPrivateProfileName("private-../../home")).toBe(false);
    expect(isPrivateProfileName("Default")).toBe(false);
    expect(isPrivateProfileName(`${privateProfileName(uuid)}x`)).toBe(false);
  });

  it("keeps them in RAM on Linux when /dev/shm is writable, one folder per browser profile", () => {
    expect(privateProfilesBase("linux", "/tmp", true, "/home/a/.config/Browser")).toMatchObject({ base: "/dev/shm", inMemory: true });
    expect(privateProfilesBase("linux", "/tmp", false, "/p")).toMatchObject({ base: "/tmp", inMemory: false });
    expect(privateProfilesBase("win32", "C:\\Temp", true, "/p")).toMatchObject({ base: "C:\\Temp", inMemory: false });
    expect(privateProfilesBase("linux", "/tmp", true, "/a").folder).not.toBe(privateProfilesBase("linux", "/tmp", true, "/b").folder);
    expect(profileKey("/a")).toMatch(/^[0-9a-f]{8}$/);
    expect(profileKey("/a")).toBe(profileKey("/a"));
  });
});
