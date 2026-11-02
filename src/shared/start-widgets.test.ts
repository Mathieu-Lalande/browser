import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings } from "./settings";
import {
  LIMITS,
  addTodo,
  addWidget,
  applyPreset,
  canAdd,
  clearDoneTodos,
  defaultWidgets,
  isoWeek,
  monthGrid,
  moveWidget,
  removeWidget,
  resizeWidget,
  sanitizeWidgets,
  shiftWidget,
  toggleTodo,
  uniqueWidgetId,
  updateWidgetOptions,
  visibleWidgets,
  widgetSpan,
  withLocalContent,
  withoutLocalContent,
  type StartWidget,
} from "./start-widgets";
import { pickSyncedSettings, syncedSettingsPatch } from "./sync/records";

const kinds = (widgets: readonly StartWidget[]) => widgets.map((widget) => widget.kind);

describe("start page widgets", () => {
  it("defaults to clock, search and frequent sites", () => {
    expect(kinds(DEFAULT_SETTINGS.startPage.widgets)).toEqual(["clock", "search", "top-sites"]);
  });

  it("validates a stored list: unknown kinds, bad ids, duplicates, sizes and options", () => {
    const widgets = sanitizeWidgets([
      { id: "clock", kind: "clock", size: "xl", options: { greeting: "yes", date: true } },
      { id: "clock", kind: "notes", size: "s" },
      { id: "Bad id!", kind: "notes" },
      { id: "x", kind: "rocket" },
      { id: "clock-2", kind: "clock" },
      { id: "notes", kind: "notes", size: "s", options: { text: "a\u0000b\nc", extra: 1 } },
      { id: "w", kind: "weather", options: { place: { name: "Paris", latitude: 48.85, longitude: 2.35 }, unit: "k" } },
      { id: "w2", kind: "weather", options: { place: { name: "Nowhere", latitude: 200, longitude: 0 } } },
      { id: "t", kind: "todo", options: { items: [{ id: "t1", text: "Lait", done: true }, { id: "t1", text: "dup" }, { id: "t2", text: 3 }] } },
      { id: "s", kind: "top-sites", options: { count: 99, pins: [{ url: "javascript:alert(1)" }, { url: "https://a.test/", title: "A" }] } },
    ]);
    expect(widgets).toEqual([
      { id: "clock", kind: "clock", size: "l", options: { greeting: true, date: true } },
      { id: "notes", kind: "notes", size: "s", options: { text: "ab\nc" } },
      { id: "w", kind: "weather", size: "s", options: { place: { name: "Paris", region: "", latitude: 48.85, longitude: 2.35 }, unit: "c" } },
      { id: "w2", kind: "weather", size: "s", options: { place: null, unit: "c" } },
      { id: "t", kind: "todo", size: "m", options: { items: [{ id: "t1", text: "Lait", done: true }], hideDone: false } },
      { id: "s", kind: "top-sites", size: "l", options: { count: 12, pins: [{ url: "https://a.test/", title: "A" }] } },
    ]);
    expect(sanitizeWidgets("nope")).toBeUndefined();
    expect(sanitizeWidgets(Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, kind: "notes" })))).toHaveLength(LIMITS.widgets);
  });

  it("goes through the settings validator, and migrates the old clock and frequent sites switches", () => {
    const bad = sanitizeSettings({ startPage: { widgets: 3, background: "dynamic" } });
    expect(bad.startPage.widgets).toEqual(DEFAULT_SETTINGS.startPage.widgets);
    expect(bad.startPage.background).toBe("dynamic");
    expect(kinds(sanitizeSettings({ startPage: { showClock: false, showTopSites: true } }).startPage.widgets)).toEqual(["search", "top-sites"]);
    expect(kinds(sanitizeSettings({ startPage: { showTopSites: false } }).startPage.widgets)).toEqual(["clock", "search"]);
    // A patch without widgets keeps the current ones.
    const custom = mergeSettings(DEFAULT_SETTINGS, { startPage: { widgets: [{ id: "notes", kind: "notes" }] } });
    expect(kinds(mergeSettings(custom, { startPage: { greetingName: "Léa" } }).startPage.widgets)).toEqual(["notes"]);
  });

  it("adds, removes, moves, shifts and resizes", () => {
    let widgets = defaultWidgets();
    expect(canAdd(widgets, "clock")).toBe(false);
    expect(addWidget(widgets, "clock")).toEqual(widgets);
    widgets = addWidget(widgets, "notes");
    widgets = addWidget(widgets, "notes", 0);
    expect(widgets.map((widget) => widget.id)).toEqual(["notes-2", "clock", "search", "top-sites", "notes"]);
    expect(uniqueWidgetId(widgets, "todo")).toBe("todo");
    widgets = moveWidget(widgets, "notes-2", 99);
    expect(widgets.at(-1)?.id).toBe("notes-2");
    widgets = shiftWidget(widgets, "clock", -1);
    expect(widgets[0].id).toBe("clock");
    widgets = shiftWidget(widgets, "clock", 1);
    expect(widgets[1].id).toBe("clock");
    expect(resizeWidget(widgets, "search", "s").find((widget) => widget.id === "search")?.size).toBe("l"); // not offered
    expect(resizeWidget(widgets, "notes", "l").find((widget) => widget.id === "notes")?.size).toBe("l");
    expect(removeWidget(widgets, "notes")).toHaveLength(4);
  });

  it("updates options through the kind's validator", () => {
    const widgets = addWidget([], "top-sites");
    const next = updateWidgetOptions(widgets, "top-sites", { count: 4, pins: [{ url: "https://b.test/", title: "B" }], bogus: true });
    expect(next[0].options).toEqual({ count: 4, pins: [{ url: "https://b.test/", title: "B" }] });
    expect(updateWidgetOptions(next, "top-sites", { count: "many" })[0].options).toEqual(next[0].options);
  });

  it("manages to-do items", () => {
    let items = addTodo([], "  Acheter du pain ");
    items = addTodo(items, "   ");
    items = addTodo(items, "Appeler");
    expect(items.map((item) => item.text)).toEqual(["Acheter du pain", "Appeler"]);
    items = toggleTodo(items, items[0].id);
    expect(clearDoneTodos(items).map((item) => item.text)).toEqual(["Appeler"]);
    expect(new Set(addTodo(items, "Encore").map((item) => item.id)).size).toBe(3);
  });

  it("applies presets, keeping the widgets already there", () => {
    let widgets = updateWidgetOptions(addWidget(defaultWidgets(), "notes"), "notes", { text: "garde-moi" });
    widgets = addWidget(widgets, "weather");
    const minimal = applyPreset(widgets, "minimal");
    expect(kinds(minimal)).toEqual(["clock", "search"]);
    const productive = applyPreset(widgets, "productive");
    expect(kinds(productive)).toEqual(["clock", "search", "todo", "notes", "calendar", "resume", "top-sites"]);
    expect(productive.find((widget) => widget.kind === "notes")?.options).toEqual({ text: "garde-moi" });
    expect(new Set(productive.map((widget) => widget.id)).size).toBe(productive.length);
    const complete = applyPreset(minimal, "complete");
    expect(kinds(complete)).not.toContain("weather");
    expect(sanitizeWidgets(complete)).toEqual(complete);
  });

  it("keeps notes and tasks off the sync, and puts them back on apply", () => {
    let widgets = updateWidgetOptions(addWidget(defaultWidgets(), "notes"), "notes", { text: "secret" });
    widgets = addWidget(widgets, "todo");
    widgets = updateWidgetOptions(widgets, "todo", { items: addTodo([], "tâche") });
    const local = mergeSettings(DEFAULT_SETTINGS, { startPage: { widgets } });
    const synced = pickSyncedSettings(local);
    expect(JSON.stringify(synced)).not.toMatch(/secret|tâche/);
    expect(withoutLocalContent(widgets)).toEqual(synced.startPage.widgets);
    // Another device moved the notes first: the layout follows, the content stays this device's.
    const remote = { ...synced, startPage: { ...synced.startPage, widgets: moveWidget(synced.startPage.widgets, "notes", 0) } };
    const applied = mergeSettings(local, syncedSettingsPatch(remote, local));
    expect(applied.startPage.widgets[0]).toMatchObject({ id: "notes", options: { text: "secret" } });
    expect(withLocalContent(remote.startPage.widgets, []).find((widget) => widget.kind === "notes")?.options).toEqual({ text: "" });
  });

  it("filters what a surface shows and computes spans", () => {
    const widgets = applyPreset([], "complete");
    expect(kinds(visibleWidgets(widgets, { mobile: true }))).not.toContain("calendar");
    expect(kinds(visibleWidgets(widgets, { isPrivate: true }))).toEqual(["clock", "search", "favorites", "todo", "notes", "calendar"]);
    expect([widgetSpan("s", 4), widgetSpan("m", 4), widgetSpan("l", 4), widgetSpan("m", 1)]).toEqual([1, 2, 4, 1]);
  });

  it("builds a month grid starting on Monday, with ISO week numbers", () => {
    const { weeks, weekNumbers } = monthGrid(new Date(2026, 10, 2)); // November 2026 starts on a Sunday
    expect(weeks).toHaveLength(6);
    expect(weeks[0].slice(5).map((day) => [day.day, day.inMonth])).toEqual([
      [31, false],
      [1, true],
    ]);
    expect(weeks[1].find((day) => day.today)?.day).toBe(2);
    expect(weekNumbers[1]).toBe(45);
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53);
  });
});
