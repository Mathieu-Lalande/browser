import { describe, expect, it } from "vitest";
// @ts-expect-error: plain ESM script, no type declarations.
import { median, summarize, sumMetrics, toMarkdown } from "./bench-report.mjs";

describe("bench report (ADR-043)", () => {
  it("computes medians and summaries, ignoring missing runs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(summarize([10.4, Number.NaN, 12.6, 11])).toEqual({ median: 11, min: 10, max: 13, runs: 3 });
    expect(summarize([1.26, 1.24], 1)).toEqual({ median: 1.3, min: 1.2, max: 1.3, runs: 2 });
  });

  it("sums the working set of every process in MB", () => {
    expect(sumMetrics([{ memory: { workingSetSize: 1024 } }, { memory: { workingSetSize: 512 } }, {}])).toEqual({ memoryMb: 1.5, processes: 3 });
  });

  it("writes a labelled Markdown table", () => {
    const markdown = toMarkdown({
      date: "2026-11-03T12:00:00.000Z",
      runs: 3,
      newTabRuns: 8,
      environment: { label: "CI Linux", os: "linux 6.1", cpu: "Test CPU", cores: 4, memoryGb: 16, build: "dev", appVersion: "0.4.0", electron: "44.0.0", commit: "abc1234" },
      metrics: { coldStartFirstPaintMs: { median: 1234, min: 1200, max: 1300, runs: 3 }, memory30TabsMb: { median: 1520.5, min: 1520.5, max: 1520.5, runs: 1 } },
    });
    expect(markdown).toContain("Mesuré le 2026-11-03 sur CI Linux (linux 6.1, Test CPU, 4 cœurs, 16 Go)");
    expect(markdown).toContain("| Démarrage à froid → premier rendu de l'interface |");
    expect(markdown).toMatch(/1\s234 ms/);
    expect(markdown).toMatch(/1\s520,5 Mo/);
    expect(markdown).not.toContain("Mémoire, 10 onglets |");
    expect(markdown).toContain("scripts/bench-compare.md");
  });
});
