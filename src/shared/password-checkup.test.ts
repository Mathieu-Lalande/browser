import { describe, expect, it } from "vitest";
import { buildReport, checkupCounts, checkupScore, isWeakPassword, parseRange, rangeParts, reuseCounts } from "./password-checkup";

describe("password checkup", () => {
  it("flags weak passwords", () => {
    for (const weak of ["abc", "password", "Azerty123", "aaaaaaaaaa", "123456789", "abcdefgh", "lowercase"]) expect(isWeakPassword(weak), weak).toBe(true);
    for (const strong of ["c0rrect-Horse-battery", "Tr0ub4dor&3x", "longer passphrase only lower case words"]) expect(isWeakPassword(strong), strong).toBe(false);
  });

  it("counts reuse across entries, ignoring empty passwords", () => {
    const counts = reuseCounts([
      { id: "a", password: "same" },
      { id: "b", password: "same" },
      { id: "c", password: "other" },
      { id: "d", password: "" },
      { id: "e", password: "" },
    ]);
    expect(Object.fromEntries(counts)).toEqual({ a: 1, b: 1, c: 0, d: 0, e: 0 });
  });

  it("sends only a 5-character prefix and parses padded ranges", () => {
    expect(rangeParts("5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8")).toEqual({ prefix: "5BAA6", suffix: "1E4C9B93F3F0682250B6CF8331B7EE68FD8" });
    const range = parseRange("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n0000000000000000000000000000000000A:0\r\nnot a line");
    expect([...range]).toEqual([["1E4C9B93F3F0682250B6CF8331B7EE68FD8", 3861493]]);
  });

  it("lists problem entries worst first, with counts and a score", () => {
    const entries = [
      { id: "ok", password: "c0rrect-Horse-battery" },
      { id: "weak", password: "azerty" },
      { id: "r1", password: "Shared-Secret-42!" },
      { id: "r2", password: "Shared-Secret-42!" },
      { id: "pwned", password: "Another-Long-One-9" },
    ];
    const report = buildReport(entries, new Map([["pwned", 12]]), "ok", 1);
    expect(report.issues.map((issue) => issue.id)).toEqual(["pwned", "r1", "r2", "weak"]);
    expect(checkupCounts(report)).toEqual({ breached: 1, reused: 2, weak: 1 });
    expect(checkupScore(report)).toBe(0 + Math.round(100 - (5 / 5) * 100));
    expect(buildReport(entries, null, "skipped", 1).issues.every((issue) => issue.breached === null)).toBe(true);
    expect(checkupScore(buildReport([{ id: "ok", password: "c0rrect-Horse-battery" }], new Map(), "ok", 1))).toBe(100);
  });
});
