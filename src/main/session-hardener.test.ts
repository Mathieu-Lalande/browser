import type { Session } from "electron";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@shared/settings";
import type { SessionService } from "./services";
import { SessionHardener } from "./session-hardener";

const CHROME_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Browser/0.4.0 Chrome/140.0.0.0 Electron/44.0.0 Safari/537.36";

function fakeSession() {
  return { getUserAgent: () => CHROME_UA, setUserAgent: vi.fn() };
}

function setup() {
  const calls: string[] = [];
  const service = (name: string): SessionService => ({
    install: (_ses, options) => void calls.push(`${name}:install${options?.ephemeral ? ":ephemeral" : ""}`),
    release: () => void calls.push(`${name}:release`),
  });
  let current: Settings = DEFAULT_SETTINGS;
  const listeners: ((settings: Settings) => void)[] = [];
  const hardener = new SessionHardener({
    services: [service("privacy"), service("downloads"), { install: () => void calls.push("certificates:install") }],
    appName: () => "Browser",
    locale: () => "fr-FR",
    settings: () => current,
    onSettingsChanged: (listener) => listeners.push(listener),
  });
  const changeSettings = (next: Settings) => {
    current = next;
    for (const listener of listeners) listener(next);
  };
  return { hardener, calls, changeSettings, listeners };
}

describe("SessionHardener", () => {
  it("installs every session service once per session, in order", () => {
    const { hardener, calls } = setup();
    const ses = fakeSession();
    expect(hardener.harden(ses as unknown as Session)).toBe(ses);
    hardener.harden(ses as unknown as Session);
    expect(calls).toEqual(["privacy:install", "downloads:install", "certificates:install"]);
    hardener.harden(fakeSession() as unknown as Session, { ephemeral: true });
    expect(calls.slice(3)).toEqual(["privacy:install:ephemeral", "downloads:install:ephemeral", "certificates:install"]);
  });

  it("gives sessions a reduced user agent without the app nor Electron", () => {
    const { hardener } = setup();
    const ses = fakeSession();
    hardener.harden(ses as unknown as Session);
    const [userAgent] = ses.setUserAgent.mock.calls[0];
    expect(userAgent).not.toMatch(/Electron|Browser\//);
    expect(userAgent).toMatch(/Chrome\//);
  });

  it("re-applies the languages of every session when the setting changes", () => {
    const { hardener, changeSettings, listeners } = setup();
    const first = fakeSession();
    const second = fakeSession();
    hardener.harden(first as unknown as Session);
    hardener.harden(second as unknown as Session);
    expect(listeners).toHaveLength(1);
    const privacy = { ...DEFAULT_SETTINGS.privacy, normalizeAcceptLanguage: !DEFAULT_SETTINGS.privacy.normalizeAcceptLanguage };
    changeSettings({ ...DEFAULT_SETTINGS, privacy });
    expect(first.setUserAgent).toHaveBeenCalledTimes(2);
    expect(second.setUserAgent).toHaveBeenCalledTimes(2);
  });

  it("lets the services release a session that goes away", () => {
    const { hardener, calls } = setup();
    const ses = fakeSession() as unknown as Session;
    hardener.harden(ses);
    hardener.release(ses);
    expect(hardener.isHardened(ses)).toBe(false);
    expect(calls.slice(3)).toEqual(["privacy:release", "downloads:release"]);
    // Hardened again from scratch if it ever comes back.
    hardener.harden(ses);
    expect(calls).toHaveLength(8);
  });
});
