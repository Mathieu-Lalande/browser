import type { ProcessMetric, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { WindowPort } from "./ports";
import { TaskManagerService } from "./tasks";

const contents = (pid: number, extra: Partial<Record<string, unknown>> = {}) =>
  ({
    isDestroyed: () => false,
    isCrashed: () => false,
    getOSProcessId: () => pid,
    getType: () => "window",
    forcefullyCrashRenderer: vi.fn(),
    ...extra,
  }) as unknown as WebContents & { forcefullyCrashRenderer: ReturnType<typeof vi.fn> };

const metric = (pid: number, type: string, cpu: number, memory: number): ProcessMetric =>
  ({ pid, type, cpu: { percentCPUUsage: cpu, idleWakeupsPerSecond: 0 }, memory: { workingSetSize: memory, peakWorkingSetSize: memory }, creationTime: 0, sandboxed: true, integrityLevel: "unknown" }) as ProcessMetric;

describe("TaskManagerService (metrics mapping)", () => {
  const page = contents(30);
  const hidden = contents(40);
  const window = (isPrivate: boolean, pages: Record<string, WebContents | null>, titles: Record<string, string>, ui: WebContents) =>
    ({
      isPrivate,
      window: { webContents: ui },
      spaces: {
        allTabs: () => Object.keys(pages).map((id) => ({ manager: { pageOf: (tabId: string) => pages[tabId] }, tab: { id, title: titles[id], url: `https://${id}.example/` } })),
      },
    }) as unknown as WindowPort;
  const service = new TaskManagerService({
    windows: {
      all: () => [window(false, { a: page, asleep: null }, { a: "Exemple", asleep: "Endormi" }, contents(20)), window(true, { p: hidden }, { p: "Secret" }, contents(20))],
    } as never,
    metrics: () => [metric(1, "Browser", 2, 100_000), metric(20, "Tab", 1, 80_000), metric(30, "Tab", 25, 150_000), metric(40, "Tab", 0, 50_000), metric(50, "Tab", 0, 30_000)],
    allContents: () => [contents(50, { getType: () => "backgroundPage", getTitle: () => "Bloqueur", getURL: () => "chrome-extension://x/" })],
  });

  it("maps every process to its tabs, extensions and the interface", () => {
    const rows = service.list();
    expect(rows.map((row) => [row.pid, row.kind, row.title, row.killable])).toEqual([
      [1, "browser", "Navigateur", false],
      [20, "interface", "Interface : Barre latérale et onglets", false],
      [30, "tab", "Onglet : Exemple", true],
      // A private window's tab is listed without its title.
      [40, "tab", "Onglet : Onglet privé", true],
      [50, "extension", "Extension : Bloqueur", false],
    ]);
    expect(rows[2]).toMatchObject({ cpu: 25, memoryKb: 150_000 });
  });

  it("only ends tab renderers", () => {
    expect(service.kill(1)).toBe(false);
    expect(service.kill(20)).toBe(false);
    expect(service.kill(30)).toBe(true);
    expect((page as unknown as { forcefullyCrashRenderer: ReturnType<typeof vi.fn> }).forcefullyCrashRenderer).toHaveBeenCalledOnce();
  });
});
