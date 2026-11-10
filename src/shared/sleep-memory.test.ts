import { describe, expect, it } from "vitest";
import { estimateFreedKb, sleepSavings } from "./sleep-memory";

describe("estimateFreedKb", () => {
  const samples = [
    { pid: 10, memoryKb: 90_000 },
    { pid: 11, memoryKb: 0 },
  ];

  it("shares a process among its pages", () => {
    expect(estimateFreedKb(10, samples, 1)).toBe(90_000);
    expect(estimateFreedKb(10, samples, 3)).toBe(30_000);
    expect(estimateFreedKb(10, samples, 0)).toBe(90_000);
  });

  it("says nothing it did not measure", () => {
    expect(estimateFreedKb(12, samples, 1)).toBeNull();
    expect(estimateFreedKb(11, samples, 1)).toBeNull();
    expect(estimateFreedKb(0, samples, 1)).toBeNull();
  });
});

describe("sleepSavings", () => {
  it("adds up the sleeping tabs that were measured", () => {
    expect(
      sleepSavings([
        { isAsleep: true, sleepFreedKb: 50_000 },
        { isAsleep: true },
        { isAsleep: false, sleepFreedKb: 999 },
        { isAsleep: true, sleepFreedKb: 25_000 },
        { isAsleep: true, sleepFreedKb: Number.NaN },
      ]),
    ).toEqual({ asleep: 4, measured: 2, freedKb: 75_000 });
    expect(sleepSavings([])).toEqual({ asleep: 0, measured: 0, freedKb: 0 });
  });
});
