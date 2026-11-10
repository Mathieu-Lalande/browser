import { describe, expect, it } from "vitest";
import type { DownloadEntry } from "./downloads";
import { publicEntry, resumePlan, resumeStateOf, sameResumeState, sanitizeResume } from "./download-resume";

const resume = { urlChain: ["http://a.test/file", "https://cdn.a.test/file.zip"], etag: '"abc"', lastModified: "", startTime: 1_700_000_000 };

const entry = (patch: Partial<DownloadEntry> = {}): DownloadEntry => ({
  id: "d1",
  url: "http://a.test/file",
  filename: "file.zip",
  path: "/downloads/file.zip",
  mimeType: "application/zip",
  totalBytes: 1000,
  receivedBytes: 400,
  state: "interrupted",
  speed: 0,
  dangerous: false,
  awaitingConfirmation: false,
  canResume: true,
  startedAt: 1,
  endedAt: 2,
  resume,
  ...patch,
});

describe("sanitizeResume", () => {
  it("keeps web redirect chains with a validator", () => {
    expect(sanitizeResume(resume)).toEqual(resume);
    expect(sanitizeResume({ ...resume, etag: "", lastModified: "Tue, 10 Nov 2026 10:00:00 GMT" })?.lastModified).toBe("Tue, 10 Nov 2026 10:00:00 GMT");
  });

  it("refuses what could not continue safely", () => {
    expect(sanitizeResume({ ...resume, etag: "" })).toBeUndefined();
    expect(sanitizeResume({ ...resume, urlChain: ["file:///etc/passwd"] })).toBeUndefined();
    expect(sanitizeResume({ ...resume, urlChain: [] })).toBeUndefined();
    expect(sanitizeResume({ ...resume, urlChain: "http://a.test" })).toBeUndefined();
    expect(sanitizeResume(null)).toBeUndefined();
    expect(sanitizeResume({ ...resume, startTime: -3 })?.startTime).toBe(0);
  });

  it("compares states", () => {
    expect(resumeStateOf(resume)).toEqual(resume);
    expect(sameResumeState(resume, { ...resume })).toBe(true);
    expect(sameResumeState(resume, { ...resume, etag: '"other"' })).toBe(false);
    expect(sameResumeState(undefined, undefined)).toBe(true);
    expect(sameResumeState(resume, undefined)).toBe(false);
  });
});

describe("resumePlan", () => {
  it("continues from the partial file on disk", () => {
    expect(resumePlan(entry(), 512)).toEqual({
      path: "/downloads/file.zip",
      urlChain: resume.urlChain,
      mimeType: "application/zip",
      offset: 512,
      length: 1000,
      lastModified: "",
      eTag: '"abc"',
      startTime: resume.startTime,
    });
    // Unknown size: still continues.
    expect(resumePlan(entry({ totalBytes: 0 }), 512)?.length).toBe(0);
  });

  it("starts over when it cannot continue", () => {
    expect(resumePlan(entry(), null)).toBeNull();
    expect(resumePlan(entry(), 0)).toBeNull();
    expect(resumePlan(entry(), 1000)).toBeNull();
    expect(resumePlan(entry({ resume: undefined }), 512)).toBeNull();
    expect(resumePlan(entry({ dangerous: true }), 512)).toBeNull();
    expect(resumePlan(entry({ path: "" }), 512)).toBeNull();
    expect(resumePlan(entry({ state: "cancelled" }), 512)).toBeNull();
    expect(resumePlan(entry({ resume: { ...resume, etag: "" } }), 512)).toBeNull();
  });
});

describe("publicEntry", () => {
  it("keeps the resume state in main", () => {
    expect(publicEntry(entry())).not.toHaveProperty("resume");
    expect(publicEntry(entry()).filename).toBe("file.zip");
    expect(publicEntry(entry({ resume: undefined }))).toEqual(entry({ resume: undefined }));
  });
});
