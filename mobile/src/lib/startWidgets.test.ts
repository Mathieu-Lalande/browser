import { DEFAULT_SETTINGS, mergeSettings } from "@shared/settings";
import { addWidget, applyPreset, visibleWidgets } from "@shared/start-widgets";
import { parseForecast, weatherCondition } from "@shared/weather";
import { dropIndex, gridColumns, widgetWidth } from "./startWidgets";

describe("start page widgets on the phone", () => {
  it("draws the phone's kinds of the shared layout, without habits in private mode", () => {
    const widgets = applyPreset(DEFAULT_SETTINGS.startPage.widgets, "complete");
    const kinds = visibleWidgets(widgets, { mobile: true }).map((widget) => widget.kind);
    expect(kinds).toEqual(["clock", "search", "top-sites", "favorites", "devices", "todo", "notes"]);
    expect(visibleWidgets(widgets, { mobile: true, isPrivate: true }).map((widget) => widget.kind)).not.toContain("top-sites");
  });

  it("keeps a layout saved by the desktop, through the settings validator", () => {
    const widgets = addWidget(DEFAULT_SETTINGS.startPage.widgets, "weather");
    const settings = mergeSettings(DEFAULT_SETTINGS, { startPage: { widgets } });
    expect(settings.startPage.widgets.map((widget) => widget.kind)).toEqual(["clock", "search", "top-sites", "weather"]);
  });

  it("sizes widgets on a 2-column grid (4 on a tablet)", () => {
    expect(gridColumns(360)).toBe(2);
    expect(gridColumns(800)).toBe(4);
    expect(widgetWidth({ size: "s" }, 332, 12)).toBe(160);
    expect(widgetWidth({ size: "m" }, 332, 12)).toBe(332);
    expect(widgetWidth({ size: "l" }, 728, 12)).toBe(728);
    expect(widgetWidth({ size: "m" }, 728, 12)).toBe(358);
  });

  it("finds where a dragged widget lands", () => {
    const rects = [
      { x: 0, y: 0, width: 332, height: 100 },
      { x: 0, y: 112, width: 160, height: 120 },
      { x: 172, y: 112, width: 160, height: 120 },
    ];
    expect(dropIndex(rects, { x: 250, y: 150 })).toBe(2);
    expect(dropIndex(rects, { x: 166, y: 106 })).toBe(0);
    expect(dropIndex(rects, { x: 80, y: 900 })).toBe(1);
    expect(dropIndex([], { x: 0, y: 0 })).toBe(-1);
  });

  it("reads Open-Meteo answers with the shared parser", () => {
    const forecast = parseForecast({ current: { temperature_2m: 3.2, weather_code: 71, is_day: 0 }, daily: {} });
    expect(forecast).toEqual({ temperature: 3.2, code: 71, isDay: false, days: [] });
    expect(weatherCondition(forecast!.code).icon).toBe("cloud-snow");
  });
});
