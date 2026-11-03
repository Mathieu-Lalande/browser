import { describe, expect, it } from "vitest";
import { buildTaskRows, formatMemory, sortTaskRows } from "./tasks";

describe("task manager rows", () => {
  const samples = [
    { pid: 1, type: "Browser", cpu: 1.26, memoryKb: 90_000 },
    { pid: 2, type: "GPU", cpu: 0.5, memoryKb: 50_000 },
    { pid: 3, type: "Tab", cpu: 12, memoryKb: 120_000 },
    { pid: 4, type: "Tab", cpu: 0, memoryKb: 40_000 },
    { pid: 5, type: "Utility", name: "Network Service", cpu: 0, memoryKb: 10_000 },
  ];
  const owners = [
    { pid: 3, kind: "interface" as const, title: "Browser" },
    { pid: 3, kind: "tab" as const, title: "Exemple", tabId: "t1" },
    { pid: 3, kind: "tab" as const, title: "Autre", tabId: "t2" },
    { pid: 4, kind: "extension" as const, title: "uBlock" },
  ];

  it("maps processes to what runs in them", () => {
    const rows = buildTaskRows(samples, owners);
    expect(rows.map((row) => [row.pid, row.kind, row.title, row.killable])).toEqual([
      [1, "browser", "Navigateur", false],
      [2, "gpu", "Processus GPU", false],
      [3, "tab", "Onglet : Exemple", true],
      [4, "extension", "Extension : uBlock", false],
      [5, "utility", "Service : Network Service", false],
    ]);
    expect(rows[2].detail).toBe("et 2 autres");
    expect(rows[0].cpu).toBe(1.3);
  });

  it("sorts by any column", () => {
    const rows = buildTaskRows(samples, owners);
    expect(sortTaskRows(rows, "memory").map((row) => row.pid)).toEqual([3, 1, 2, 4, 5]);
    expect(sortTaskRows(rows, "cpu")[0].pid).toBe(3);
    expect(sortTaskRows(rows, "title").map((row) => row.pid)).toEqual([4, 1, 3, 2, 5]);
    expect(sortTaskRows(rows, "pid", true).map((row) => row.pid)).toEqual([5, 4, 3, 2, 1]);
  });

  it("formats memory", () => {
    expect(formatMemory(12_595)).toBe("12,3 Mo");
    expect(formatMemory(204_800)).toBe("200 Mo");
  });
});
