import { describe, expect, it } from "vitest";
import { decimalOf, evaluate, formatNumber } from "./calculator";

describe("evaluate", () => {
  it.each([
    ["2*(3+4)", 14],
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 / 4", 2.5],
    ["1,5 + 1,5", 3],
    ["1.5 * 2", 3],
    ["2^10", 1024],
    ["2^3^2", 512],
    ["-2^2", -4],
    ["2^-1", 0.5],
    ["-(3 - 5)", 2],
    ["7 % 3", 1],
    ["50%", 0.5],
    ["200 * 15%", 30],
    ["3 × 4 ÷ 2", 6],
    ["= 6 * 7", 42],
    [".5 + .5", 1],
  ])("%s = %s", (input, expected) => {
    expect(evaluate(input)).toBeCloseTo(expected, 10);
  });

  it.each([
    "",
    "42",
    "-5",
    "(3)",
    "abc",
    "2 + x",
    "alert(1)",
    "Math.PI * 2",
    "2 ** 3",
    "1 +",
    "(1 + 2",
    "1 + 2)",
    "1 / 0",
    "5 % 0",
    "1e5 + 1",
    "constructor",
    "2; 3",
    "[1] + 1",
    "0x10 + 1",
    "1 = 1",
    "10^400",
    "1".repeat(201) + "+1",
    "(".repeat(40) + "1+1" + ")".repeat(40),
  ])("rejects %j", (input) => {
    expect(evaluate(input)).toBeNull();
  });
});

describe("formatNumber", () => {
  it("drops float noise and uses the given decimal separator", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0,3");
    expect(formatNumber(0.1 + 0.2, ".")).toBe("0.3");
    expect(formatNumber(14)).toBe("14");
    expect(formatNumber(-0)).toBe("0");
  });

  it("follows the separator the user typed, else the French comma", () => {
    expect(decimalOf("1.5 + 2")).toBe(".");
    expect(decimalOf("1,5 + 2")).toBe(",");
    expect(decimalOf("7 / 2")).toBe(",");
  });
});
