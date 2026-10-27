import { describe, expect, it } from "vitest";
import type { SpaceInfo } from "./types";
import {
  DEFAULT_SPACE,
  FALLBACK_SPACE_ICON,
  MAX_SPACES,
  SPACE_COLORS,
  SPACE_ICONS,
  addSpace,
  cycleSpace,
  isSpaceIcon,
  isSpaceInput,
  migrateSpaceIcon,
  neighborSpace,
  nextSpaceDefaults,
  removeSpace,
  sanitizeSpace,
  spacePartition,
  updateSpace,
} from "./spaces";

const work: SpaceInfo = { id: "work", name: "Travail", icon: "briefcase", color: SPACE_COLORS[0], isolated: true };
const list: SpaceInfo[] = [DEFAULT_SPACE, work];

describe("space model", () => {
  it("adds a space with the next unused name, icon and color", () => {
    const next = addSpace(list, "s3")!;
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ id: "s3", name: "Espace 3", icon: "palette", color: SPACE_COLORS[1], isolated: false });
    expect(addSpace(list, "s3", { name: "  Courses \n", isolated: true })![2]).toMatchObject({ name: "Courses", isolated: true });
  });

  it("refuses duplicate ids and too many spaces", () => {
    expect(addSpace(list, "work")).toBeNull();
    let spaces: SpaceInfo[] = [DEFAULT_SPACE];
    for (let i = 1; i < MAX_SPACES; i++) spaces = addSpace(spaces, `s${i}`)!;
    expect(addSpace(spaces, "one-more")).toBeNull();
  });

  it("updates only the given space, keeping its id and sanitizing input", () => {
    const updated = updateSpace(list, "work", { name: "", icon: "gamepad-2", color: null });
    expect(updated[0]).toBe(DEFAULT_SPACE);
    expect(updated[1]).toEqual({ id: "work", name: "Espace", icon: "gamepad-2", color: null, isolated: true });
  });

  it("never removes the last space", () => {
    expect(removeSpace(list, "work")).toEqual([DEFAULT_SPACE]);
    expect(removeSpace([DEFAULT_SPACE], DEFAULT_SPACE.id)).toEqual([DEFAULT_SPACE]);
  });

  it("picks the neighbour of a removed space and cycles with wrap-around", () => {
    const three = addSpace(list, "s3")!;
    expect(neighborSpace(three, "work")).toBe("s3");
    expect(neighborSpace(three, "s3")).toBe("work");
    expect(cycleSpace(three, "s3", 1)).toBe(DEFAULT_SPACE.id);
    expect(cycleSpace(three, DEFAULT_SPACE.id, -1)).toBe("s3");
  });

  it("validates input from the chrome UI", () => {
    expect(isSpaceInput({ name: "A", icon: "briefcase", color: "#aabbcc", isolated: false })).toBe(true);
    // Icons are Lucide names from the allow-list: no emoji, no arbitrary name, not the private one.
    expect(isSpaceInput({ icon: "💼" })).toBe(false);
    expect(isSpaceInput({ icon: "house" })).toBe(false);
    expect(isSpaceInput({ icon: "venetian-mask" })).toBe(false);
    expect(isSpaceInput({ icon: 3 })).toBe(false);
    expect(isSpaceInput({ color: null })).toBe(true);
    expect(isSpaceInput({ color: "red" })).toBe(false);
    expect(isSpaceInput({ id: "x" })).toBe(false);
    expect(isSpaceInput({ isolated: "yes" })).toBe(false);
    expect(isSpaceInput(null)).toBe(false);
  });

  it("rejects ids unsafe for partition names", () => {
    expect(sanitizeSpace({ id: "../x" })).toBeNull();
    expect(spacePartition("work")).toBe("persist:space-work");
  });

  it("defaults name/icon/color for new spaces", () => {
    expect(nextSpaceDefaults([DEFAULT_SPACE]).name).toBe("Espace 2");
  });

  it("offers a curated set of distinct Lucide icon names, without a house", () => {
    expect(SPACE_ICONS.length).toBe(32);
    expect(new Set(SPACE_ICONS).size).toBe(SPACE_ICONS.length);
    for (const icon of SPACE_ICONS) expect(icon).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    expect(SPACE_ICONS).not.toContain("house");
    expect(isSpaceIcon(DEFAULT_SPACE.icon)).toBe(true);
    expect(isSpaceIcon(FALLBACK_SPACE_ICON)).toBe(true);
  });
});

describe("space icon migration (emoji icons of earlier versions)", () => {
  it.each([
    ["🏠", "circle-user"],
    ["💼", "briefcase"],
    ["🎨", "palette"],
    ["📚", "book-open"],
    ["🎮", "gamepad-2"],
    ["🛒", "shopping-bag"],
    ["✈️", "plane"],
    ["✈", "plane"],
    ["🎵", "music"],
    ["💡", "lightbulb"],
    ["🧪", "flask-conical"],
    ["🌱", "sprout"],
    ["⭐", "star"],
    ["🔒", "lock"],
    ["📰", "newspaper"],
    ["🍳", "chef-hat"],
    ["❤️", "heart"],
    ["❤", "heart"],
    [" 💼\n", "briefcase"],
  ])("maps %j to %j", (emoji, icon) => {
    expect(migrateSpaceIcon(emoji)).toBe(icon);
  });

  it("keeps known names and falls back for anything else", () => {
    for (const icon of SPACE_ICONS) expect(migrateSpaceIcon(icon)).toBe(icon);
    for (const value of ["🦄", "", "house", "Briefcase", "<svg>", "venetian-mask", null, undefined, 42, {}]) {
      expect(migrateSpaceIcon(value)).toBe(FALLBACK_SPACE_ICON);
    }
  });

  it("migrates stored spaces through sanitizeSpace", () => {
    expect(sanitizeSpace({ id: "home", name: "Maison", icon: "🏠", color: "#AABBCC", isolated: false })).toEqual({
      id: "home",
      name: "Maison",
      icon: "circle-user",
      color: "#aabbcc",
      isolated: false,
    });
    expect(sanitizeSpace({ id: "x", name: "X", icon: "🦄" })?.icon).toBe(FALLBACK_SPACE_ICON);
    expect(sanitizeSpace({ id: "y", name: "Y" })?.icon).toBe(FALLBACK_SPACE_ICON);
    expect(sanitizeSpace({ id: "z", name: "Z", icon: "rocket" })?.icon).toBe("rocket");
  });
});
