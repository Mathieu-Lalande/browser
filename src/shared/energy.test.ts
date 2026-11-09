import { describe, expect, it } from "vitest";
import { ENERGY_OFF, SAVER_SLEEP_CAP_MS, energyPolicy, energyState, energyTooltip, sameEnergyState } from "./energy";

describe("energy saver", () => {
  it("is on always, on battery only in auto mode, never when off", () => {
    expect(energyState("always", false)).toEqual({ active: true, reason: "always" });
    expect(energyState("battery", true)).toEqual({ active: true, reason: "battery" });
    expect(energyState("battery", false)).toEqual(ENERGY_OFF);
    expect(energyState("off", true)).toEqual(ENERGY_OFF);
    expect(sameEnergyState(energyState("always", true), energyState("always", false))).toBe(true);
    expect(sameEnergyState(energyState("battery", true), energyState("always", true))).toBe(false);
  });

  it("caps the sleep delay while on, keeps the user's choice otherwise", () => {
    const on = energyPolicy(energyState("always", false));
    const off = energyPolicy(energyState("off", true));
    expect(on.sleepDelayMs(30 * 60_000)).toBe(SAVER_SLEEP_CAP_MS);
    expect(on.sleepDelayMs(60_000)).toBe(60_000);
    expect(on.sleepDelayMs(null)).toBeNull();
    expect(off.sleepDelayMs(30 * 60_000)).toBe(30 * 60_000);
  });

  it("takes thumbnails less often, stops background media polling and animations while on", () => {
    const on = energyPolicy({ active: true, reason: "battery" });
    const off = energyPolicy(ENERGY_OFF);
    expect(on.captureSettleMs(700)).toBeGreaterThan(off.captureSettleMs(700));
    expect(off.captureSettleMs(700)).toBe(700);
    expect([on.captureOnLoad, on.pollBackgroundMedia, on.reduceMotion, on.backgroundThrottling]).toEqual([false, false, true, true]);
    expect([off.captureOnLoad, off.pollBackgroundMedia, off.reduceMotion, off.backgroundThrottling]).toEqual([true, true, false, false]);
  });

  it("explains itself in the window bar", () => {
    expect(energyTooltip(ENERGY_OFF)).toBeNull();
    expect(energyTooltip({ active: true, reason: "battery" })).toMatch(/batterie/);
    expect(energyTooltip({ active: true, reason: "always" })).toMatch(/toujours/);
  });
});
