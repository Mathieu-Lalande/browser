import { describe, expect, it } from "vitest";
import { NotificationThrottle, notificationTitle, parseWebNotification } from "./notifications";
import { sanitizeSettings } from "./settings";
import { isDictionaryWord, spellLanguagesFor } from "./spellcheck";
import { webauthnChoices, webauthnSupport } from "./webauthn";

// ADR-041: notifications, spell checker languages, passkeys.

describe("web notifications", () => {
  it("parses and caps page requests", () => {
    expect(parseWebNotification(JSON.stringify({ id: "a1", title: "Salut‮", body: "x".repeat(900), silent: true }))).toEqual({
      id: "a1",
      title: "Salut",
      body: "x".repeat(400),
      tag: "",
      silent: true,
    });
    expect(parseWebNotification(JSON.stringify({ id: "A B", title: "t" }))).toBeNull();
    expect(parseWebNotification(JSON.stringify({ id: "a", title: "", body: "" }))).toBeNull();
    expect(parseWebNotification("{")).toBeNull();
  });

  it("always names the site, and rate limits per site", () => {
    expect(notificationTitle("exemple.fr", "Nouveau message")).toBe("exemple.fr — Nouveau message");
    const throttle = new NotificationThrottle(2, 1000);
    expect([throttle.take("a", 0), throttle.take("a", 10), throttle.take("a", 20), throttle.take("b", 20), throttle.take("a", 1500)]).toEqual([true, true, false, true, true]);
  });
});

describe("spell checker", () => {
  it("keeps chosen dictionaries Chromium has, else the locale's", () => {
    const available = ["en-US", "en-GB", "fr", "de"];
    expect(spellLanguagesFor(["fr", "xx"], available, "en-US")).toEqual(["fr"]);
    expect(spellLanguagesFor([], available, "fr-FR")).toEqual(["fr"]);
    expect(spellLanguagesFor([], available, "en")).toEqual(["en-US"]);
    expect(spellLanguagesFor([], available, "ja")).toEqual([]);
  });

  it("validates settings and words", () => {
    const settings = sanitizeSettings({ spellcheck: { languages: ["fr", "fr", "en-US", "bad code", 3] } });
    expect(settings.spellcheck.languages).toEqual(["fr", "en-US"]);
    expect(settings.autofill).toEqual({ addresses: true, cards: true, syncAddresses: false });
    expect(isDictionaryWord("Lalande")).toBe(true);
    expect(isDictionaryWord("deux mots")).toBe(false);
  });
});

describe("passkeys", () => {
  it("states what each system supports", () => {
    expect(webauthnSupport("win32")).toEqual({ platform: true, securityKey: true, securityKeyPin: true, phone: true });
    expect(webauthnSupport("darwin").platform).toBe(false);
    expect(webauthnSupport("darwin", true).platform).toBe(true);
    expect(webauthnSupport("linux")).toEqual({ platform: false, securityKey: true, securityKeyPin: false, phone: false });
  });

  it("labels the accounts of the chooser", () => {
    expect(webauthnChoices([{ credentialId: "a", name: "jeanne@ex.fr", displayName: "Jeanne" }, { credentialId: "b" }])).toEqual([
      { credentialId: "a", label: "Jeanne (jeanne@ex.fr)" },
      { credentialId: "b", label: "Clé d'accès 2" },
    ]);
  });
});
