import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROFILES_FILE, ProfileService, profileDir, readProfiles } from "./service";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(current = "default") {
  const root = mkdtempSync(join(tmpdir(), "profiles-"));
  dirs.push(root);
  const spawned: string[][] = [];
  let n = 0;
  const service = new ProfileService(root, current, { args: [".", "--no-sandbox"], packaged: false, spawn: (args) => spawned.push(args) }, undefined, undefined, () => `r${++n}abc`);
  return { root, service, spawned };
}

describe("ProfileService", () => {
  it("keeps an existing profile as « Personnel » at the root, without moving data", () => {
    const { root, service } = setup();
    writeFileSync(join(root, "history.json"), "{}");
    expect(service.view()).toMatchObject({ current: "default", profiles: [{ id: "default", name: "Personnel" }] });
    expect(profileDir(root, "default")).toBe(root);
    service.markUsed();
    expect(existsSync(join(root, "history.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, PROFILES_FILE), "utf8")).lastUsed).toBe("default");
  });

  it("creates, edits, opens and deletes profiles in their own folders", () => {
    const { root, service, spawned } = setup();
    const work = service.create({ name: "Travail", icon: "briefcase" })!;
    expect(work).toMatchObject({ id: "travail-r1abc", name: "Travail", icon: "briefcase" });
    expect(profileDir(root, work.id)).toBe(join(root, "Profiles", work.id));
    expect(service.edit(work.id, { name: "Bureau", color: "#16a34a" })).toBe(true);
    expect(readProfiles(root).profiles[1]).toMatchObject({ name: "Bureau", color: "#16a34a" });

    expect(service.open(work.id)).toBe(true);
    expect(spawned).toEqual([[".", "--no-sandbox", `--profile=${work.id}`]]);
    expect(service.open("unknown")).toBe(false);

    mkdirSync(profileDir(root, work.id), { recursive: true });
    writeFileSync(join(profileDir(root, work.id), "history.json"), "{}");
    expect(service.remove("default")).toBe(false);
    expect(service.remove(work.id)).toBe(true);
    expect(existsSync(profileDir(root, work.id))).toBe(false);
    expect(readProfiles(root).profiles.map((profile) => profile.id)).toEqual(["default"]);
  });

  it("never deletes the open profile, and remembers the launch choice", () => {
    const { root, service } = setup();
    const other = service.create({ name: "Autre" })!;
    const inOther = new ProfileService(root, other.id, { args: [], packaged: true, spawn: () => {} });
    expect(inOther.remove(other.id)).toBe(false);
    inOther.setAskOnLaunch(true);
    inOther.markUsed();
    expect(readProfiles(root)).toMatchObject({ lastUsed: other.id, askOnLaunch: true });
    expect(inOther.info().name).toBe("Autre");
  });
});
