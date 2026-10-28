import { describe, expect, it } from "vitest";
import {
  ACTIVATION_WINDOW_MS,
  EXTERNAL_LAUNCH_INTERVAL_MS,
  IN_PAGE_VISIT_INTERVAL_MS,
  InPageVisits,
  UserActivation,
  isActivatingInput,
  isPeekGesture,
} from "./activation";

const T = 1_000_000;

describe("UserActivation (audit MEDIUM-1, LOW-1)", () => {
  it("refuses popups without a recent trusted input", () => {
    const activation = new UserActivation();
    expect(activation.consumeOpen(T)).toBe(false);
    activation.record(T);
    expect(activation.consumeOpen(T + ACTIVATION_WINDOW_MS + 1)).toBe(false);
  });

  it("lets one gesture open one tab", () => {
    const activation = new UserActivation();
    activation.record(T);
    expect(activation.consumeOpen(T + 200)).toBe(true);
    expect(activation.consumeOpen(T + 300)).toBe(false);
    // The next click opens one more.
    activation.record(T + 400);
    expect(activation.consumeOpen(T + 450)).toBe(true);
    expect(activation.consumeOpen(T + 460)).toBe(false);
  });

  it("allows an external app launch per gesture, at most once every few seconds", () => {
    const activation = new UserActivation();
    expect(activation.consumeExternal(T)).toBe(false);
    activation.record(T);
    expect(activation.consumeExternal(T + 10)).toBe(true);
    activation.record(T + 100);
    expect(activation.consumeExternal(T + 110)).toBe(false);
    activation.record(T + EXTERNAL_LAUNCH_INTERVAL_MS + 20);
    expect(activation.consumeExternal(T + EXTERNAL_LAUNCH_INTERVAL_MS + 30)).toBe(true);
  });

  it("shares one gesture between popups and external launches", () => {
    const activation = new UserActivation();
    activation.record(T);
    expect(activation.consumeExternal(T + 10)).toBe(true);
    expect(activation.consumeOpen(T + 20)).toBe(false);
  });

  it("ignores a clock going backwards", () => {
    const activation = new UserActivation();
    activation.record(T);
    expect(activation.consumeOpen(T - 5000)).toBe(false);
  });
});

describe("isActivatingInput", () => {
  it("counts presses, not moves, releases or held keys", () => {
    expect(isActivatingInput({ type: "mouseDown" })).toBe(true);
    expect(isActivatingInput({ type: "keyDown" })).toBe(true);
    expect(isActivatingInput({ type: "rawKeyDown" })).toBe(true);
    expect(isActivatingInput({ type: "touchStart" })).toBe(true);
    expect(isActivatingInput({ type: "gestureTap" })).toBe(true);
    expect(isActivatingInput({ type: "keyDown", isAutoRepeat: true })).toBe(false);
    expect(isActivatingInput({ type: "mouseMove" })).toBe(false);
    expect(isActivatingInput({ type: "mouseUp" })).toBe(false);
    expect(isActivatingInput({ type: "keyUp" })).toBe(false);
    expect(isActivatingInput({ type: "mouseWheel" })).toBe(false);
    // Modifier keys alone do not activate a page (as in Chromium).
    expect(isActivatingInput({ type: "keyDown", key: "Shift" })).toBe(false);
    expect(isActivatingInput({ type: "keyDown", key: "Control" })).toBe(false);
  });
});

describe("link peek gesture (ADR-027)", () => {
  it("is a left click, with Shift alone when modifiers are known", () => {
    expect(isPeekGesture({ type: "mouseDown", button: "left", modifiers: ["shift"] })).toBe(true);
    expect(isPeekGesture({ type: "mouseDown", button: "left", modifiers: ["shift", "leftbuttondown"] })).toBe(true);
    expect(isPeekGesture({ type: "mouseDown", button: "left", modifiers: [] })).toBe(false);
    // Electron 44 reports no modifiers: Shift then comes from the `new-window` disposition.
    expect(isPeekGesture({ type: "mouseDown", button: "left" })).toBe(true);
    expect(isPeekGesture({ type: "mouseDown", button: "right" })).toBe(false);
    expect(isPeekGesture({ type: "mouseDown", button: "left", modifiers: ["shift", "control"] })).toBe(false);
    expect(isPeekGesture({ type: "mouseDown", button: "middle", modifiers: ["shift"] })).toBe(false);
    expect(isPeekGesture({ type: "mouseUp", button: "left", modifiers: ["shift"] })).toBe(false);
  });

  it("is used up once, like any gesture, and only after a left click", () => {
    const activation = new UserActivation();
    activation.record(1000);
    expect(activation.consumePeek(1001)).toBe(false);
    activation.record(2000, true);
    expect(activation.consumePeek(2001)).toBe(true);
    expect(activation.consumePeek(2002)).toBe(false);
    expect(activation.consumeOpen(2003)).toBe(false);
    activation.record(5000, true);
    expect(activation.consumePeek(5000 + ACTIVATION_WINDOW_MS + 1)).toBe(false);
  });
});

describe("InPageVisits (audit MEDIUM-4)", () => {
  it("records at most one in-page visit per second, distinct URLs only", () => {
    const visits = new InPageVisits();
    expect(visits.accept("https://a.com/1", T)).toBe(true);
    expect(visits.accept("https://a.com/1", T + IN_PAGE_VISIT_INTERVAL_MS + 1)).toBe(false);
    expect(visits.accept("https://a.com/2", T + 10)).toBe(false);
    expect(visits.accept("https://a.com/3", T + IN_PAGE_VISIT_INTERVAL_MS)).toBe(true);
    // A pushState storm records almost nothing.
    let recorded = 0;
    for (let i = 0; i < 1000; i++) if (visits.accept(`https://a.com/spam/${i}`, T + 5000 + i)) recorded++;
    expect(recorded).toBe(1);
  });

  it("starts over after a full navigation", () => {
    const visits = new InPageVisits();
    visits.accept("https://a.com/1", T);
    visits.reset("https://a.com/2");
    expect(visits.accept("https://a.com/2", T + 10)).toBe(false);
    expect(visits.accept("https://a.com/3", T + 20)).toBe(true);
  });
});
