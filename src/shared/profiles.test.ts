import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_ID,
  launchProfile,
  newProfileId,
  profileFromArgs,
  profileSegments,
  relaunchArgs,
  sanitizeProfiles,
  shouldPickProfile,
} from "./profiles";

describe("profiles registry", () => {
  it("migrates a profile without registry to « Personnel » at the root", () => {
    const data = sanitizeProfiles(undefined);
    expect(data.profiles).toEqual([expect.objectContaining({ id: DEFAULT_PROFILE_ID, name: "Personnel" })]);
    expect(data.lastUsed).toBe(DEFAULT_PROFILE_ID);
    expect(profileSegments(DEFAULT_PROFILE_ID)).toEqual([]);
    expect(profileSegments("work-1")).toEqual(["Profiles", "work-1"]);
  });

  it("drops invalid and duplicate entries and keeps the default first", () => {
    const data = sanitizeProfiles({
      profiles: [
        { id: "work-1", name: " Travail ", color: "#123456", icon: "briefcase" },
        { id: "work-1", name: "Doublon" },
        { id: "../evil", name: "x" },
        { id: "default", name: "Moi", icon: "nope" },
      ],
      lastUsed: "gone",
      askOnLaunch: true,
    });
    expect(data.profiles.map((profile) => profile.id)).toEqual(["default", "work-1"]);
    expect(data.profiles[0]).toMatchObject({ name: "Moi", icon: "circle-user" });
    expect(data.profiles[1]).toMatchObject({ name: "Travail", color: "#123456", icon: "briefcase" });
    expect(data.lastUsed).toBe("default");
  });

  it("chooses the launch profile and the picker", () => {
    const data = sanitizeProfiles({ profiles: [{ id: "work-1", name: "Travail" }], lastUsed: "work-1", askOnLaunch: true });
    expect(launchProfile(data, null)).toBe("work-1");
    expect(launchProfile(data, "default")).toBe("default");
    expect(launchProfile(data, "unknown")).toBe("work-1");
    expect(shouldPickProfile(data, null)).toBe(true);
    expect(shouldPickProfile(data, "default")).toBe(false);
    expect(shouldPickProfile(sanitizeProfiles({ askOnLaunch: true }), null)).toBe(false);
  });

  it("reads and writes the profile switch", () => {
    expect(profileFromArgs(["app", "--profile=work-1"])).toBe("work-1");
    expect(profileFromArgs(["app", "--profile=../x"])).toBeNull();
    expect(relaunchArgs([".", "--no-sandbox", "https://a.example/", "--profile=old"], false, "new")).toEqual([".", "--no-sandbox", "--profile=new"]);
    expect(relaunchArgs(["--flag", "https://a.example/"], true, "new")).toEqual(["--flag", "--profile=new"]);
  });

  it("makes ids from names", () => {
    expect(newProfileId("Été Travail !", () => "Ab12cd34")).toBe("ete-travail-b12cd3");
    expect(newProfileId("***", () => "zz")).toBe("profil-zz");
  });
});
