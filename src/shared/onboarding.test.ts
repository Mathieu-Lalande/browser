import { describe, expect, it } from "vitest";
import { getCommand } from "./commands";
import {
  WELCOME_STEPS,
  WELCOME_TIPS,
  WELCOME_TRANSITION_MS,
  goToWelcome,
  initialWelcome,
  isLastStep,
  nextWelcome,
  previousWelcome,
  shouldOpenWelcome,
  welcomeKeyAction,
} from "./onboarding";
import { DEFAULT_SETTINGS, freshProfileSettings, sanitizeSettings } from "./settings";

describe("onboarding steps", () => {
  it("goes through the five steps in order, then ends", () => {
    let state = initialWelcome();
    const visited = [state.step];
    for (let next = nextWelcome(state); next; next = nextWelcome(state)) {
      state = next;
      visited.push(state.step);
    }
    expect(visited).toEqual([...WELCOME_STEPS]);
    expect(isLastStep(state)).toBe(true);
    expect(state.seen).toEqual(WELCOME_STEPS.slice(0, -1));
    expect(nextWelcome(state)).toBeNull();
  });

  it("goes back, never before the first step, and jumps to any step", () => {
    expect(previousWelcome(initialWelcome()).step).toBe("hello");
    const jumped = goToWelcome(initialWelcome(), "default");
    expect(jumped).toEqual({ step: "default", seen: ["hello"] });
    expect(previousWelcome(jumped).step).toBe("import");
    expect(goToWelcome(jumped, "hello").seen).toEqual(["hello", "default"]);
  });

  it("maps the keyboard", () => {
    expect(welcomeKeyAction("ArrowRight")).toBe("next");
    expect(welcomeKeyAction("ArrowLeft")).toBe("previous");
    expect(welcomeKeyAction("Escape")).toBe("skip");
    expect(welcomeKeyAction("a")).toBeNull();
  });

  it("names real commands for its shortcuts and stays fast", () => {
    for (const tip of WELCOME_TIPS) if (tip.command) expect(getCommand(tip.command)).toBeDefined();
    expect(WELCOME_TIPS.map((tip) => tip.id)).toEqual(["omnibox", "spaces", "peek", "compact"]);
    expect(WELCOME_TRANSITION_MS).toBeLessThanOrEqual(160);
  });
});

describe("when the welcome page opens", () => {
  it("opens on a fresh profile only, unless something else comes first", () => {
    expect(shouldOpenWelcome({ completed: freshProfileSettings().onboarding.completed })).toBe(true);
    expect(shouldOpenWelcome({ completed: false, otherPageFirst: true })).toBe(false);
    expect(shouldOpenWelcome({ completed: false, suppressed: true })).toBe(false);
    expect(shouldOpenWelcome({ completed: true })).toBe(false);
  });

  it("treats a profile from an older version (no onboarding field) as done", () => {
    expect(sanitizeSettings({ appearance: { mode: "dark" } }).onboarding.completed).toBe(true);
    expect(DEFAULT_SETTINGS.onboarding.completed).toBe(true);
    expect(freshProfileSettings()).toEqual({ ...DEFAULT_SETTINGS, onboarding: { completed: false } });
    expect(sanitizeSettings({ onboarding: { completed: "yes" } }, freshProfileSettings()).onboarding.completed).toBe(false);
  });
});
