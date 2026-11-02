import { widgetSpan, type StartWidget } from "@shared/start-widgets";
import { WEATHER_TIMEOUT_MS, WeatherClient } from "@shared/weather";

/**
 * Phone start screen widgets (ADR-034): the shared model, laid out on a 2-column grid (4 on a
 * tablet). Pure helpers for the layout and the drag-to-reorder gesture, and the weather client.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const gridColumns = (width: number): number => (width >= 700 ? 4 : 2);

/** Width of a widget of `size` in a grid `width` wide (outer padding excluded). */
export function widgetWidth(widget: Pick<StartWidget, "size">, width: number, gap: number): number {
  const columns = gridColumns(width);
  const span = widgetSpan(widget.size, columns);
  const column = (width - gap * (columns - 1)) / columns;
  return Math.floor(column * span + gap * (span - 1));
}

/**
 * Where a dragged widget lands: the index of the widget under the finger, or of the nearest one
 * (by center distance) when the finger is between cards; -1 without any card.
 */
export function dropIndex(rects: readonly Rect[], point: { x: number; y: number }): number {
  let best = -1;
  let bestDistance = Infinity;
  rects.forEach((rect, index) => {
    if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) {
      bestDistance = -1;
      best = index;
    }
    if (bestDistance < 0) return;
    const distance = Math.hypot(rect.x + rect.width / 2 - point.x, rect.y + rect.height / 2 - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Open-Meteo, with the shared 30 min cache (only asked once a weather widget has a city). */
export const weather = new WeatherClient(fetchJson);
