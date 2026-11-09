import { describe, expect, it } from "vitest";
import { AutoPipPolicy } from "./auto-pip";

const on = { enabled: true, canEnter: () => true };

describe("auto picture-in-picture policy", () => {
  it("pops the video of the tab left, and puts it back on return", () => {
    const policy = new AutoPipPolicy();
    expect(policy.activate("a", on)).toEqual([]);
    expect(policy.activate("b", on)).toEqual([{ kind: "enter", tabId: "a" }]);
    policy.entered("a", "entered");
    expect(policy.poppedTabs).toEqual(["a"]);
    expect(policy.activate("a", on)).toEqual([
      { kind: "exit", tabId: "a" },
      { kind: "enter", tabId: "b" },
    ]);
    expect(policy.poppedTabs).toEqual([]);
  });

  it("does nothing when off, for sleeping tabs, or when the site refused", () => {
    const policy = new AutoPipPolicy();
    policy.activate("a", on);
    expect(policy.activate("b", { enabled: false, canEnter: () => true })).toEqual([]);
    expect(policy.activate("a", { enabled: true, canEnter: () => false })).toEqual([]);
    expect(policy.activate("b", on)).toEqual([{ kind: "enter", tabId: "a" }]);
    policy.entered("a", "disabled");
    expect(policy.activate("a", on)).toEqual([{ kind: "enter", tabId: "b" }]);
  });

  it("a late answer for a tab back on screen is not remembered; closed tabs are forgotten", () => {
    const policy = new AutoPipPolicy();
    policy.activate("a", on);
    policy.activate("b", on);
    policy.activate("a", on);
    policy.entered("a", "entered");
    expect(policy.isOnScreen("a")).toBe(true);
    expect(policy.poppedTabs).toEqual([]);
    policy.activate("b", on);
    policy.entered("a", "entered");
    policy.forget("a");
    expect(policy.activate("a", on)).toEqual([{ kind: "enter", tabId: "b" }]);
  });
});
