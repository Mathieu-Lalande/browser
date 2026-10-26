import { describe, expect, it } from "vitest";
import type { SpaceInfo } from "./types";
import {
  DEFAULT_SPACE,
  MAX_SPACES,
  SPACE_COLORS,
  addSpace,
  cycleSpace,
  isSpaceInput,
  neighborSpace,
  nextSpaceDefaults,
  removeSpace,
  sanitizeSpace,
  spacePartition,
  updateSpace,
} from "./spaces";

const work: SpaceInfo = { id: "work", name: "Travail", icon: "💼", color: SPACE_COLORS[0], isolated: true };
const list: SpaceInfo[] = [DEFAULT_SPACE, work];

describe("space model", () => {
  it("adds a space with the next unused name, icon and color", () => {
    const next = addSpace(list, "s3")!;
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ id: "s3", name: "Espace 3", icon: "🎨", color: SPACE_COLORS[1], isolated: false });
    expect(addSpace(list, "s3", { name: "  Courses \n", isolated: true })![2]).toMatchObject({ name: "Courses", isolated: true });
  });

  it("refuses duplicate ids and too many spaces", () => {
    expect(addSpace(list, "work")).toBeNull();
    let spaces: SpaceInfo[] = [DEFAULT_SPACE];
    for (let i = 1; i < MAX_SPACES; i++) spaces = addSpace(spaces, `s${i}`)!;
    expect(addSpace(spaces, "one-more")).toBeNull();
  });

  it("updates only the given space, keeping its id and sanitizing input", () => {
    const updated = updateSpace(list, "work", { name: "", icon: "🎮", color: null });
    expect(updated[0]).toBe(DEFAULT_SPACE);
    expect(updated[1]).toEqual({ id: "work", name: "Espace", icon: "🎮", color: null, isolated: true });
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
    expect(isSpaceInput({ name: "A", icon: "🏠", color: "#aabbcc", isolated: false })).toBe(true);
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
});
