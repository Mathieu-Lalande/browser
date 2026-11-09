import { describe, expect, it } from "vitest";
import type { DownloadEntry } from "./downloads";
import { MAX_DESKTOP_SPACES, desktopTasks, micaSupported, parseLaunchActions, taskbarDownloads } from "./desktop";

const download = (overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
  id: "d",
  url: "https://example.com/f",
  filename: "f",
  path: "",
  mimeType: "",
  totalBytes: 100,
  receivedBytes: 25,
  state: "progressing",
  speed: 0,
  dangerous: false,
  awaitingConfirmation: false,
  canResume: false,
  startedAt: 0,
  endedAt: null,
  ...overrides,
});

describe("launch actions", () => {
  it("reads --new-tab, --private and --space=<id>, skipping the executable", () => {
    expect(parseLaunchActions(["browser.exe", "--new-tab"])).toEqual({ newTab: true, private: false, spaceId: null });
    expect(parseLaunchActions(["browser.exe", "--private"])).toEqual({ newTab: false, private: true, spaceId: null });
    expect(parseLaunchActions(["electron", ".", "--space=work-1"])).toEqual({ newTab: false, private: false, spaceId: "work-1" });
  });

  it("is null without an action, and refuses odd space ids", () => {
    expect(parseLaunchActions(["--new-tab"])).toBeNull();
    expect(parseLaunchActions(["browser", "https://example.com", "--profile=abc"])).toBeNull();
    expect(parseLaunchActions(["browser", "--space=../x"])).toBeNull();
    expect(parseLaunchActions(["browser", "--space="])).toBeNull();
    expect(parseLaunchActions(["browser", "--new-tabs", "-private"])).toBeNull();
  });
});

describe("jump list and dock tasks", () => {
  it("offers a new tab, a private window, and the spaces", () => {
    const { tasks, spaces } = desktopTasks([
      { id: "personal", name: "Personnel" },
      { id: "bad id", name: "Ignoré" },
    ]);
    expect(tasks.map((task) => [task.title, task.args])).toEqual([
      ["Nouvel onglet", "--new-tab"],
      ["Nouvelle fenêtre privée", "--private"],
    ]);
    expect(spaces).toEqual([{ title: "Personnel", description: "Affiche l'espace « Personnel »", args: "--space=personal" }]);
    expect(parseLaunchActions(["b", spaces[0].args])?.spaceId).toBe("personal");
  });

  it("keeps a few spaces only", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: `S${i}` }));
    expect(desktopTasks(many).spaces).toHaveLength(MAX_DESKTOP_SPACES);
  });
});

describe("taskbar downloads", () => {
  it("shows the overall progress of running downloads", () => {
    expect(taskbarDownloads([])).toEqual({ progress: null, running: 0 });
    expect(taskbarDownloads([download({ state: "completed" })])).toEqual({ progress: null, running: 0 });
    expect(taskbarDownloads([download(), download({ id: "e", totalBytes: 300, receivedBytes: 75 })])).toEqual({ progress: 0.25, running: 2 });
    expect(taskbarDownloads([download({ totalBytes: 0 })])).toEqual({ progress: "indeterminate", running: 1 });
    expect(taskbarDownloads([download({ state: "paused" })])).toEqual({ progress: 0.25, running: 0 });
  });
});

describe("mica", () => {
  it("needs Windows 11", () => {
    expect(micaSupported("win32", "10.0.22631")).toBe(true);
    expect(micaSupported("win32", "10.0.19045")).toBe(false);
    expect(micaSupported("darwin", "23.0.0")).toBe(false);
    expect(micaSupported("win32", "garbage")).toBe(false);
  });
});
