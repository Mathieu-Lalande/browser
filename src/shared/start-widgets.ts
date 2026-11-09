import { t, type MessageKey } from "./i18n";
import { isNavigableUrl } from "./url";

/**
 * Customizable new tab page (ADR-034): an ordered list of widgets, stored in
 * `settings.startPage.widgets` and shared by the desktop and the phone. Pure: the validator,
 * the catalog, the edit operations and the presets. The UIs only draw a widget list.
 */

export const WIDGET_KINDS = ["clock", "search", "top-sites", "favorites", "devices", "notes", "weather", "calendar", "todo", "resume"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/** S: one grid column; M: two; L: the whole row (two columns on a narrow grid). */
export const WIDGET_SIZES = ["s", "m", "l"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export type TemperatureUnit = "c" | "f";

export interface WeatherPlace {
  name: string;
  /** Region and country, for the list of search results ("Île-de-France, France"). */
  region: string;
  latitude: number;
  longitude: number;
}

export interface PinnedSite {
  url: string;
  title: string;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface WidgetOptionsByKind {
  clock: { greeting: boolean; date: boolean };
  search: Record<string, never>;
  "top-sites": { count: number; pins: PinnedSite[] };
  favorites: { count: number };
  devices: { count: number };
  /** Local content: never synced (see `withoutLocalContent`). */
  notes: { text: string };
  weather: { place: WeatherPlace | null; unit: TemperatureUnit };
  calendar: { weekNumbers: boolean };
  /** Local content: never synced. */
  todo: { items: TodoItem[]; hideDone: boolean };
  resume: { count: number };
}

export type StartWidgetOf<K extends WidgetKind> = { id: string; kind: K; size: WidgetSize; options: WidgetOptionsByKind[K] };
export type StartWidget = { [K in WidgetKind]: StartWidgetOf<K> }[WidgetKind];

/** Lucide names (both UIs map them in their `Icon` component). */
export type WidgetIcon =
  | "clock"
  | "search"
  | "trending-up"
  | "layout-grid"
  | "monitor-smartphone"
  | "sticky-note"
  | "cloud-sun"
  | "calendar"
  | "list-todo"
  | "rotate-ccw-clock";

export interface WidgetInfo {
  label: string;
  description: string;
  icon: WidgetIcon;
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  /** At most one on the page. */
  single: boolean;
  /** Drawn by the phone's start screen too. */
  mobile: boolean;
  /** Calls a third-party service: off until the user adds it. */
  network: boolean;
  /** Shows browsing habits: hidden in private windows. */
  revealsHabits: boolean;
}

export const LIMITS = {
  widgets: 12,
  notes: 2000,
  todoItems: 30,
  todoText: 120,
  pins: 8,
  pinTitle: 60,
  placeName: 80,
  count: { min: 2, max: 12 },
} as const;

export const WIDGET_CATALOG: Readonly<Record<WidgetKind, WidgetInfo>> = {
  clock: info("startWidgets.clock", "clock", ["s", "m", "l"], "l", { single: true }),
  search: info("startWidgets.search", "search", ["m", "l"], "l", { single: true }),
  "top-sites": info("startWidgets.topSites", "trending-up", ["m", "l"], "l", {
    single: true,
    revealsHabits: true,
  }),
  favorites: info("startWidgets.favorites", "layout-grid", ["m", "l"], "m", { single: true }),
  devices: info("startWidgets.devices", "monitor-smartphone", ["s", "m", "l"], "m", {
    single: true,
    revealsHabits: true,
  }),
  notes: info("startWidgets.notes", "sticky-note", ["s", "m", "l"], "m"),
  weather: info("startWidgets.weather", "cloud-sun", ["s", "m"], "s", { network: true }),
  calendar: info("startWidgets.calendar", "calendar", ["s", "m"], "s", { single: true, mobile: false }),
  todo: info("startWidgets.todo", "list-todo", ["s", "m", "l"], "m"),
  resume: info("startWidgets.resume", "rotate-ccw-clock", ["s", "m", "l"], "m", {
    single: true,
    mobile: false,
    revealsHabits: true,
  }),
};

/** Texts are catalog keys (`key`, `${key}Description`), read in the UI language (ADR-052). */
function info(
  key: MessageKey,
  icon: WidgetIcon,
  sizes: readonly WidgetSize[],
  defaultSize: WidgetSize,
  flags: Partial<Pick<WidgetInfo, "single" | "mobile" | "network" | "revealsHabits">> = {},
): WidgetInfo {
  return {
    get label() {
      return t(key);
    },
    get description() {
      return t(`${key}Description` as MessageKey);
    },
    icon,
    sizes,
    defaultSize,
    single: false,
    mobile: true,
    network: false,
    revealsHabits: false,
    ...flags,
  };
}

export const SIZE_LABELS: Readonly<Record<WidgetSize, string>> = {
  get s() {
    return t("startWidgets.sizeSmall");
  },
  get m() {
    return t("startWidgets.sizeMedium");
  },
  get l() {
    return t("startWidgets.sizeLarge");
  },
};

export function defaultOptions<K extends WidgetKind>(kind: K): WidgetOptionsByKind[K] {
  const defaults: { [P in WidgetKind]: () => WidgetOptionsByKind[P] } = {
    clock: () => ({ greeting: true, date: false }),
    search: () => ({}),
    "top-sites": () => ({ count: 8, pins: [] }),
    favorites: () => ({ count: 8 }),
    devices: () => ({ count: 5 }),
    notes: () => ({ text: "" }),
    weather: () => ({ place: null, unit: "c" }),
    calendar: () => ({ weekNumbers: false }),
    todo: () => ({ items: [], hideDone: false }),
    resume: () => ({ count: 5 }),
  };
  return defaults[kind]();
}

export function createWidget(kind: WidgetKind, id: string, size: WidgetSize = WIDGET_CATALOG[kind].defaultSize): StartWidget {
  return { id, kind, size, options: defaultOptions(kind) } as StartWidget;
}

/** Clock, search and frequent sites: the page as it was before widgets. */
export const DEFAULT_WIDGETS: readonly StartWidget[] = [createWidget("clock", "clock"), createWidget("search", "search"), createWidget("top-sites", "top-sites")];

export const defaultWidgets = (): StartWidget[] => structuredClone(DEFAULT_WIDGETS) as StartWidget[];

// --- Validation -------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const ID = /^[a-z][a-z0-9-]{0,39}$/;
export const isWidgetKind = (value: unknown): value is WidgetKind => WIDGET_KINDS.includes(value as WidgetKind);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
/** One line of text, without control characters. */
const line = (value: unknown, max: number): string | undefined =>
  // eslint-disable-next-line no-control-regex
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : undefined;
/** Several lines (tabs and newlines kept). */
const multiline = (value: unknown, max: number): string | undefined => (typeof value === "string" ? value.replace(CONTROL, "").slice(0, max) : undefined);
const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(LIMITS.count.max, Math.max(LIMITS.count.min, Math.round(value))) : undefined;
const coordinate = (value: unknown, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max ? Math.round(value * 10_000) / 10_000 : undefined;

export function sanitizePlace(value: unknown): WeatherPlace | null {
  if (!isRecord(value)) return null;
  const name = line(value.name, LIMITS.placeName)?.trim();
  const latitude = coordinate(value.latitude, 90);
  const longitude = coordinate(value.longitude, 180);
  if (!name || latitude === undefined || longitude === undefined) return null;
  return { name, region: line(value.region, LIMITS.placeName)?.trim() ?? "", latitude, longitude };
}

function sanitizePins(value: unknown): PinnedSite[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pins: PinnedSite[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.url !== "string" || item.url.length > 2048 || !/^https?:\/\//i.test(item.url) || !isNavigableUrl(item.url)) continue;
    if (pins.some((pin) => pin.url === item.url)) continue;
    pins.push({ url: item.url, title: line(item.title, LIMITS.pinTitle)?.trim() ?? "" });
    if (pins.length === LIMITS.pins) break;
  }
  return pins;
}

function sanitizeTodos(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: TodoItem[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || !ID.test(item.id) || items.some((other) => other.id === item.id)) continue;
    const text = line(item.text, LIMITS.todoText);
    if (text === undefined) continue;
    items.push({ id: item.id, text, done: item.done === true });
    if (items.length === LIMITS.todoItems) break;
  }
  return items;
}

type OptionFields<K extends WidgetKind> = { [F in keyof WidgetOptionsByKind[K]]-?: (value: unknown) => WidgetOptionsByKind[K][F] | undefined };

const OPTION_FIELDS: { [K in WidgetKind]: OptionFields<K> } = {
  clock: { greeting: bool, date: bool },
  search: {},
  "top-sites": { count, pins: sanitizePins },
  favorites: { count },
  devices: { count },
  notes: { text: (value) => multiline(value, LIMITS.notes) },
  weather: { place: (value) => (value === null ? null : (sanitizePlace(value) ?? undefined)), unit: (value) => (value === "c" || value === "f" ? value : undefined) },
  calendar: { weekNumbers: bool },
  todo: { items: sanitizeTodos, hideDone: bool },
  resume: { count },
};

/** Options of `kind` from anything: invalid or missing fields fall back to `base` (default: the kind's defaults). */
export function sanitizeOptions<K extends WidgetKind>(kind: K, value: unknown, base: WidgetOptionsByKind[K] = defaultOptions(kind)): WidgetOptionsByKind[K] {
  const input = isRecord(value) ? value : {};
  const fields = OPTION_FIELDS[kind] as Record<string, (value: unknown) => unknown>;
  const fallback = base as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) result[key] = fields[key](input[key]) ?? fallback[key];
  return result as WidgetOptionsByKind[K];
}

/**
 * The stored widget list from anything: unknown kinds, bad ids, duplicates, a second copy of a
 * single widget and sizes the kind does not offer are dropped or fixed; at most `LIMITS.widgets`.
 * Undefined when `value` is not a list (the settings validator keeps the previous one).
 */
export function sanitizeWidgets(value: unknown): StartWidget[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const widgets: StartWidget[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isWidgetKind(item.kind) || typeof item.id !== "string" || !ID.test(item.id)) continue;
    const kind = item.kind;
    if (widgets.some((widget) => widget.id === item.id) || !canAdd(widgets, kind)) continue;
    const catalog = WIDGET_CATALOG[kind];
    const size = catalog.sizes.includes(item.size as WidgetSize) ? (item.size as WidgetSize) : catalog.defaultSize;
    widgets.push({ id: item.id, kind, size, options: sanitizeOptions(kind, item.options) } as StartWidget);
  }
  return widgets;
}

/**
 * Settings saved before widgets (`showClock`, `showTopSites`): the default layout without what
 * was turned off. Undefined when there is nothing to migrate.
 */
export function migrateLegacyStartPage(startPage: Record<string, unknown>): StartWidget[] | undefined {
  if (startPage.widgets !== undefined || (startPage.showClock !== false && startPage.showTopSites !== false)) return undefined;
  return defaultWidgets().filter(
    (widget) => !(widget.kind === "clock" && startPage.showClock === false) && !(widget.kind === "top-sites" && startPage.showTopSites === false),
  );
}

// --- Edit operations (each returns a new list) -------------------------------------------------

export function canAdd(widgets: readonly StartWidget[], kind: WidgetKind): boolean {
  return widgets.length < LIMITS.widgets && !(WIDGET_CATALOG[kind].single && widgets.some((widget) => widget.kind === kind));
}

/** A free id for a new widget of `kind`: the kind's name, then `kind-2`, `kind-3`… */
export function uniqueWidgetId(widgets: readonly { id: string }[], kind: WidgetKind): string {
  const taken = new Set(widgets.map((widget) => widget.id));
  if (!taken.has(kind)) return kind;
  let n = 2;
  while (taken.has(`${kind}-${n}`)) n++;
  return `${kind}-${n}`;
}

/** Adds a widget of `kind` at `index` (default: the end); unchanged when not allowed. */
export function addWidget(widgets: readonly StartWidget[], kind: WidgetKind, index = widgets.length): StartWidget[] {
  if (!canAdd(widgets, kind)) return [...widgets];
  const next = [...widgets];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, createWidget(kind, uniqueWidgetId(widgets, kind)));
  return next;
}

export function removeWidget(widgets: readonly StartWidget[], id: string): StartWidget[] {
  return widgets.filter((widget) => widget.id !== id);
}

/** Moves the widget to `index` (clamped). */
export function moveWidget(widgets: readonly StartWidget[], id: string, index: number): StartWidget[] {
  const from = widgets.findIndex((widget) => widget.id === id);
  if (from < 0) return [...widgets];
  const next = [...widgets];
  const [widget] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, widget);
  return next;
}

/** One step backwards (-1) or forwards (+1): keyboard reordering. */
export function shiftWidget(widgets: readonly StartWidget[], id: string, delta: number): StartWidget[] {
  const from = widgets.findIndex((widget) => widget.id === id);
  return from < 0 ? [...widgets] : moveWidget(widgets, id, from + delta);
}

export function resizeWidget(widgets: readonly StartWidget[], id: string, size: WidgetSize): StartWidget[] {
  return widgets.map((widget) => (widget.id === id && WIDGET_CATALOG[widget.kind].sizes.includes(size) ? { ...widget, size } : widget));
}

/** Merges a partial options update (validated against the kind) into the widget's options. */
export function updateWidgetOptions(widgets: readonly StartWidget[], id: string, patch: Record<string, unknown>): StartWidget[] {
  return widgets.map((widget) =>
    widget.id === id ? ({ ...widget, options: sanitizeOptions(widget.kind, { ...widget.options, ...patch }, widget.options as never) } as StartWidget) : widget,
  );
}

// --- To-do items -------------------------------------------------------------------------------

export function addTodo(items: readonly TodoItem[], text: string): TodoItem[] {
  const clean = line(text, LIMITS.todoText)?.trim();
  if (!clean || items.length >= LIMITS.todoItems) return [...items];
  const taken = new Set(items.map((item) => item.id));
  let n = items.length + 1;
  while (taken.has(`t${n}`)) n++;
  return [...items, { id: `t${n}`, text: clean, done: false }];
}

export const toggleTodo = (items: readonly TodoItem[], id: string): TodoItem[] => items.map((item) => (item.id === id ? { ...item, done: !item.done } : item));
export const removeTodo = (items: readonly TodoItem[], id: string): TodoItem[] => items.filter((item) => item.id !== id);
export const clearDoneTodos = (items: readonly TodoItem[]): TodoItem[] => items.filter((item) => !item.done);

// --- Presets -----------------------------------------------------------------------------------

export type PresetId = "minimal" | "productive" | "complete";

export const LAYOUT_PRESETS: readonly { id: PresetId; label: string; widgets: readonly { kind: WidgetKind; size: WidgetSize }[] }[] = [
  {
    id: "minimal",
    get label() { return t("startWidgets.minimal") },
    widgets: [
      { kind: "clock", size: "l" },
      { kind: "search", size: "l" },
    ],
  },
  {
    id: "productive",
    get label() { return t("startWidgets.productive") },
    widgets: [
      { kind: "clock", size: "l" },
      { kind: "search", size: "l" },
      { kind: "todo", size: "m" },
      { kind: "notes", size: "m" },
      { kind: "calendar", size: "s" },
      { kind: "resume", size: "m" },
      { kind: "top-sites", size: "l" },
    ],
  },
  {
    id: "complete",
    get label() { return t("startWidgets.complete") },
    widgets: [
      { kind: "clock", size: "l" },
      { kind: "search", size: "l" },
      { kind: "top-sites", size: "l" },
      { kind: "favorites", size: "m" },
      { kind: "devices", size: "m" },
      { kind: "todo", size: "m" },
      { kind: "notes", size: "m" },
      { kind: "calendar", size: "s" },
      { kind: "resume", size: "m" },
    ],
  },
];

/**
 * The preset's layout. Widgets of the same kind already on the page are reused (their notes,
 * tasks and options are kept); the weather never comes with a preset (it calls the network).
 */
export function applyPreset(widgets: readonly StartWidget[], presetId: PresetId): StartWidget[] {
  const preset = LAYOUT_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) return [...widgets];
  const result: StartWidget[] = [];
  for (const { kind, size } of preset.widgets) {
    const existing = widgets.find((widget) => widget.kind === kind && !result.includes(widget));
    result.push(existing ? ({ ...existing, size } as StartWidget) : createWidget(kind, uniqueWidgetId([...widgets, ...result], kind), size));
  }
  return result;
}

// --- Sync (ADR-019): notes and tasks stay on the device ----------------------------------------

/** The list as synced: notes and to-do items emptied. */
export function withoutLocalContent(widgets: readonly StartWidget[]): StartWidget[] {
  return widgets.map((widget) => {
    if (widget.kind === "notes") return { ...widget, options: { ...widget.options, text: "" } };
    if (widget.kind === "todo") return { ...widget, options: { ...widget.options, items: [] } };
    return widget;
  });
}

/** A synced list with this device's notes and tasks put back (matched by id and kind). */
export function withLocalContent(synced: readonly StartWidget[], local: readonly StartWidget[]): StartWidget[] {
  return synced.map((widget) => {
    const mine = local.find((other) => other.id === widget.id && other.kind === widget.kind);
    if (mine?.kind === "notes" && widget.kind === "notes") return { ...widget, options: { ...widget.options, text: mine.options.text } };
    if (mine?.kind === "todo" && widget.kind === "todo") return { ...widget, options: { ...widget.options, items: mine.options.items } };
    return widget;
  });
}

// --- Display helpers ---------------------------------------------------------------------------

/** Widgets a surface draws: the phone skips desktop-only kinds; private windows skip habits. */
export function visibleWidgets(widgets: readonly StartWidget[], { mobile = false, isPrivate = false } = {}): StartWidget[] {
  return widgets.filter((widget) => (!mobile || WIDGET_CATALOG[widget.kind].mobile) && !(isPrivate && WIDGET_CATALOG[widget.kind].revealsHabits));
}

/** Grid columns a widget spans in a grid of `columns`. */
export function widgetSpan(size: WidgetSize, columns: number): number {
  const span = size === "s" ? 1 : size === "m" ? 2 : columns;
  return Math.max(1, Math.min(span, columns));
}

/** "Bonjour" until 18 h, "Bonsoir" in the evening and at night (in the UI language). */
export const greetingFor = (hour: number): string => t(hour < 5 || hour >= 18 ? "startWidgets.goodEvening" : "startWidgets.hello");

export interface CalendarDay {
  day: number;
  inMonth: boolean;
  today: boolean;
}

/** The month of `date` as weeks starting on Monday (6 rows, days of the adjacent months included). */
export function monthGrid(date: Date): { weeks: CalendarDay[][]; weekNumbers: number[] } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const weeks: CalendarDay[][] = [];
  const weekNumbers: number[] = [];
  for (let week = 0; week < 6; week++) {
    const days: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      const day = new Date(year, month, 1 - offset + week * 7 + weekday);
      days.push({ day: day.getDate(), inMonth: day.getMonth() === month, today: day.toDateString() === date.toDateString() });
      if (weekday === 3) weekNumbers.push(isoWeek(day));
    }
    weeks.push(days);
  }
  return { weeks, weekNumbers };
}

/** ISO 8601 week number of a date (the week's Thursday decides the year). */
export function isoWeek(date: Date): number {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
