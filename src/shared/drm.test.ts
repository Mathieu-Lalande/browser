import { describe, expect, it } from "vitest";
import { widevineLabel, widevineStatus, type WidevineFacts } from "./drm";

const facts = (patch: Partial<WidevineFacts> = {}): WidevineFacts => ({
  enabled: true,
  supported: true,
  component: { status: "up-to-date", title: "Widevine Content Decryption Module", version: "4.10.2891.0" },
  pending: false,
  installedThisRun: false,
  platform: "win32",
  ...patch,
});

describe("widevineStatus", () => {
  it("reports the installed CDM version", () => {
    expect(widevineStatus(facts())).toEqual({ state: "ready", version: "4.10.2891.0", restartNeeded: false });
    expect(widevineLabel(widevineStatus(facts()))).toBe("Widevine 4.10.2891.0");
  });

  it("is unavailable with stock Electron, or when nothing could be installed", () => {
    expect(widevineStatus(facts({ supported: false })).state).toBe("unavailable");
    expect(widevineStatus(facts({ component: null })).state).toBe("unavailable");
    expect(widevineStatus(facts({ component: { status: "new", title: null, version: "0.0.0.0" } })).state).toBe("unavailable");
    expect(widevineStatus(facts({ component: { status: "new", title: null, version: null } })).state).toBe("unavailable");
    expect(widevineLabel(widevineStatus(facts({ supported: false })))).toBe("Widevine indisponible");
  });

  it("is installing while the first download runs", () => {
    expect(widevineStatus(facts({ component: null, pending: true })).state).toBe("installing");
  });

  it("is disabled by the setting, whatever is installed", () => {
    expect(widevineStatus(facts({ enabled: false })).state).toBe("disabled");
  });

  it("asks for a restart on Linux after a first install", () => {
    const status = widevineStatus(facts({ installedThisRun: true, platform: "linux" }));
    expect(status.restartNeeded).toBe(true);
    expect(widevineLabel(status)).toContain("prochain démarrage");
    expect(widevineStatus(facts({ installedThisRun: true })).restartNeeded).toBe(false);
  });

  it("ignores a malformed version", () => {
    expect(widevineStatus(facts({ component: { status: "x", title: null, version: "<b>" } })).state).toBe("unavailable");
  });
});
