import { describe, expect, it } from "vitest";
import { crashReporterOptions, crashSizeText, issueUrl, osText, parseCrashEndpoint, sortCrashes, MAX_LISTED_CRASHES } from "./diagnostics";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";

describe("crash endpoint", () => {
  it("accepts https URLs, http on localhost only", () => {
    expect(parseCrashEndpoint("https://relay.example.com/crash")).toEqual({ kind: "self-hosted", url: "https://relay.example.com/crash", host: "relay.example.com" });
    expect(parseCrashEndpoint("http://127.0.0.1:8787/crash")?.url).toBe("http://127.0.0.1:8787/crash");
    expect(parseCrashEndpoint("http://relay.example.com/crash")).toBeNull();
    expect(parseCrashEndpoint("ftp://relay.example.com")).toBeNull();
    expect(parseCrashEndpoint("not a url")).toBeNull();
    expect(parseCrashEndpoint("")).toBeNull();
    expect(parseCrashEndpoint(undefined)).toBeNull();
    expect(parseCrashEndpoint("https://user:pass@relay.example.com/crash")).toBeNull();
  });

  it("turns a Sentry DSN into its minidump endpoint", () => {
    expect(parseCrashEndpoint("https://abc123@o42.ingest.sentry.io/4567")).toEqual({
      kind: "sentry",
      url: "https://o42.ingest.sentry.io/api/4567/minidump/?sentry_key=abc123",
      host: "o42.ingest.sentry.io",
    });
    expect(parseCrashEndpoint("https://abc123@o42.ingest.sentry.io/not-a-project")).toBeNull();
  });
});

describe("crash settings", () => {
  const endpoint = parseCrashEndpoint("https://relay.example.com/crash");
  const options = (enabled: boolean, target = endpoint) => crashReporterOptions({ enabled, endpoint: target, productName: "Browser", version: "1.2.3", channel: "beta" });

  it("is off by default and survives bad values", () => {
    expect(DEFAULT_SETTINGS.diagnostics.crashReports).toBe(false);
    expect(sanitizeSettings({ diagnostics: { crashReports: "on" } }).diagnostics.crashReports).toBe(false);
    expect(sanitizeSettings({ diagnostics: { crashReports: true } }).diagnostics.crashReports).toBe(true);
  });

  it("uploads only when opted in and an endpoint exists", () => {
    expect(options(false).uploadToServer).toBe(false);
    expect(options(true).uploadToServer).toBe(true);
    expect(options(true, null)).toMatchObject({ uploadToServer: false, submitURL: "https://localhost.invalid/crash" });
  });

  it("annotates reports with the version and channel only", () => {
    expect(options(true)).toMatchObject({ productName: "Browser", compress: true, globalExtra: { _version: "1.2.3", channel: "beta" } });
    expect(Object.keys(options(true).globalExtra)).toEqual(["_version", "channel"]);
  });

  it("lists crashes newest first, deduplicated and capped", () => {
    const entries = Array.from({ length: 30 }, (_, n) => ({ id: `c${n % 25}`, date: n, sizeBytes: 10, state: "completed" as const }));
    const sorted = sortCrashes(entries);
    expect(sorted).toHaveLength(MAX_LISTED_CRASHES);
    expect(sorted[0]).toMatchObject({ id: "c4", date: 29 });
    expect(new Set(sorted.map((entry) => entry.id)).size).toBe(sorted.length);
  });

  it("formats sizes in French units", () => {
    expect(crashSizeText(512)).toBe("512 o");
    expect(crashSizeText(300 * 1024)).toBe("300 Ko");
    expect(crashSizeText(2.5 * 1024 * 1024)).toBe("2,5 Mo");
  });
});

describe("issue link", () => {
  it("prefills the template with the version and system, nothing else", () => {
    const url = new URL(issueUrl({ version: "0.4.0", platform: "win32", osVersion: "10.0.22631", arch: "x64", electron: "44.0.0", channel: "stable" }));
    expect(url.origin + url.pathname).toBe("https://github.com/Mathieu-Lalande/browser/issues/new");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      template: "bug.yml",
      labels: "bug",
      version: "0.4.0 (stable, Electron 44.0.0)",
      os: "Windows 10.0.22631 (x64)",
    });
    expect(osText({ platform: "darwin", osVersion: "24.1.0", arch: "arm64" })).toBe("macOS 24.1.0 (arm64)");
  });
});
