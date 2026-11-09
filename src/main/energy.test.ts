import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from "@shared/settings";
import { EnergyService } from "./energy";
import type { WindowDirectory } from "./ports";

function setup(mode: Settings["behavior"]["energySaver"], battery: boolean) {
  const power = { battery, listeners: new Map<string, () => void>() };
  let current = mergeSettings(DEFAULT_SETTINGS, { behavior: { energySaver: mode } });
  let settingsListener: (s: Settings) => void = () => {};
  const page = { setBackgroundThrottling: vi.fn(), isDestroyed: () => false };
  const windows = {
    all: () => [{ spaces: { allTabs: () => [{ manager: { pageOf: () => page }, tab: { id: "t" } }] } }],
    refreshAll: vi.fn(),
  } as unknown as WindowDirectory;
  const service = new EnergyService({
    power: { isOnBatteryPower: () => power.battery, on: (event, listener) => power.listeners.set(event, listener) },
    settings: () => current,
    onSettingsChanged: (listener) => (settingsListener = listener),
    windows,
  });
  return {
    service,
    page,
    windows,
    unplug: () => {
      power.battery = true;
      power.listeners.get("on-battery")?.();
    },
    setMode: (energySaver: Settings["behavior"]["energySaver"]) => {
      current = mergeSettings(current, { behavior: { energySaver } });
      settingsListener(current);
    },
  };
}

describe("EnergyService", () => {
  it("follows the power source in auto mode, throttles pages and re-sends window states", () => {
    const { service, page, windows, unplug } = setup("battery", false);
    expect(service.state.active).toBe(false);
    const changes: boolean[] = [];
    service.onChanged((state) => changes.push(state.active));
    unplug();
    expect(service.state).toEqual({ active: true, reason: "battery" });
    expect(page.setBackgroundThrottling).toHaveBeenCalledWith(true);
    expect(windows.refreshAll).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([true]);
  });

  it("follows the setting, and only notifies real changes", () => {
    const { service, windows, setMode } = setup("off", true);
    expect(service.state.active).toBe(false);
    setMode("off");
    expect(windows.refreshAll).not.toHaveBeenCalled();
    setMode("always");
    expect(service.state.reason).toBe("always");
    expect(service.policy.pollBackgroundMedia).toBe(false);
  });
});
