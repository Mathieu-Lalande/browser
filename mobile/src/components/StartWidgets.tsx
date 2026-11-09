import { t } from "@shared/i18n";
import { isFavoriteTab, type Favorite } from "@shared/favorites";
import { topSites } from "@shared/search";
import {
  LIMITS,
  addTodo,
  clearDoneTodos,
  greetingFor,
  removeTodo,
  toggleTodo,
  type StartWidget,
  type StartWidgetOf,
  type WeatherPlace,
  type WidgetKind,
} from "@shared/start-widgets";
import { displayUrl } from "@shared/url";
import { forecastWeekday, formatTemperature, weatherCondition, type Forecast } from "@shared/weather";
import { memo, useEffect, useMemo, useState, type ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { weather } from "../lib/startWidgets";
import { useBrowserState, useHistoryEntries } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { FavoritesRow } from "./Organize";
import { SiteIcon, Tap } from "./ui";

/**
 * The phone's widget views (ADR-034), one per kind of the shared model that the phone draws.
 * Each gets its widget and `setOptions` (validated by the model; `typing` saves after a pause).
 */

export interface WidgetActions {
  onSearch: () => void;
  onOpen: (url: string) => void;
  onLongPressSite: (url: string, title: string) => void;
  onOpenFavorite: (url: string) => void;
  onFavoriteMenu: (favorite: Favorite) => void;
  setOptions: (id: string, patch: Record<string, unknown>, typing?: boolean) => void;
}

type ViewProps<K extends WidgetKind> = { widget: StartWidgetOf<K>; actions: WidgetActions; width: number };

export function WidgetView({ widget, actions, width }: { widget: StartWidget; actions: WidgetActions; width: number }): ReactElement | null {
  switch (widget.kind) {
    case "clock":
      return <ClockWidget widget={widget} actions={actions} width={width} />;
    case "search":
      return <SearchWidget widget={widget} actions={actions} width={width} />;
    case "top-sites":
      return <TopSitesWidget widget={widget} actions={actions} width={width} />;
    case "favorites":
      return <FavoritesWidget widget={widget} actions={actions} width={width} />;
    case "devices":
      return <DevicesWidget widget={widget} actions={actions} width={width} />;
    case "notes":
      return <NotesWidget widget={widget} actions={actions} width={width} />;
    case "todo":
      return <TodoWidget widget={widget} actions={actions} width={width} />;
    case "weather":
      return <WeatherWidget widget={widget} actions={actions} width={width} />;
    default:
      return null;
  }
}

/** Kinds drawn without a card: the greeting and the search pill. */
export const BARE_KINDS: ReadonlySet<WidgetKind> = new Set(["clock", "search"]);

function Title({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.title, { color: colors.textMuted }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

function Empty({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.empty, { color: colors.textFaint }]}>{children}</Text>;
}

const ClockWidget = memo(function ClockWidget({ widget }: ViewProps<"clock">) {
  const { colors, isPrivate } = useTheme();
  const { settings } = useBrowserState();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const name = settings.startPage.greetingName.trim();
  const time = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const date = widget.options.date ? now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "";
  const greeting = widget.options.greeting && !isPrivate;
  return (
    <View style={styles.hero}>
      {greeting && <Text style={[styles.time, { color: colors.textMuted }]}>{date ? `${time} · ${date}` : time}</Text>}
      <Text style={[styles.greeting, { color: colors.text }]} accessibilityRole={isPrivate ? undefined : "header"}>
        {greeting ? `${greetingFor(now.getHours())}${name ? `, ${name}` : ""}.` : time}
      </Text>
      {!greeting && date ? <Text style={[styles.time, { color: colors.textMuted }]}>{date}</Text> : null}
    </View>
  );
});

const SearchWidget = memo(function SearchWidget({ actions }: ViewProps<"search">) {
  const { colors } = useTheme();
  return (
    <Tap
      accessibilityRole="search"
      accessibilityLabel={t("mobile.startWidgets.searchEnterAddress")}
      onPress={actions.onSearch}
      pressScale={0.97}
      style={[styles.search, { backgroundColor: colors.bgElevated, borderColor: colors.border, shadowColor: "#000" }]}
      testID="start-search"
    >
      <Icon name="search" size={20} color={colors.textMuted} />
      <Text style={[styles.searchText, { color: colors.textMuted }]}>{t("mobile.startWidgets.searchEnterAddress")}</Text>
    </Tap>
  );
});

function SiteTiles({ sites, width, actions }: { sites: { url: string; title: string }[]; width: number; actions: WidgetActions }) {
  const { colors } = useTheme();
  const columns = Math.max(3, Math.min(6, Math.floor(width / 84)));
  const tile = Math.floor((width - (columns - 1) * 8) / columns);
  return (
    <View style={styles.tiles}>
      {sites.map((site) => (
        <Tap
          key={site.url}
          accessibilityRole="link"
          accessibilityLabel={site.title}
          onPress={() => actions.onOpen(site.url)}
          onLongPress={() => actions.onLongPressSite(site.url, site.title)}
          style={[styles.tile, { width: tile }]}
          pressScale={0.92}
        >
          <View style={[styles.tileIcon, { width: Math.min(56, tile - 12), height: Math.min(56, tile - 12), backgroundColor: colors.bgElevated, borderColor: colors.hairline }]}>
            <SiteIcon url={site.url} title={site.title} size={24} plain />
          </View>
          <Text style={[styles.tileLabel, { color: colors.text }]} numberOfLines={1}>
            {site.title}
          </Text>
        </Tap>
      ))}
    </View>
  );
}

const TopSitesWidget = memo(function TopSitesWidget({ widget, actions, width }: ViewProps<"top-sites">) {
  const history = useHistoryEntries();
  const sites = useMemo(() => {
    const pins = widget.options.pins.map((pin) => ({ url: pin.url, title: pin.title || displayUrl(pin.url) }));
    const pinned = new Set(pins.map((pin) => pin.url));
    const visited = topSites(history, widget.options.count, Date.now())
      .filter((site) => !pinned.has(site.url))
      .map((site) => ({ url: site.url, title: site.title || displayUrl(site.url) }));
    return [...pins, ...visited].slice(0, widget.options.count);
  }, [history, widget.options]);
  return (
    <View style={styles.section}>
      <Title>{t("mobile.startWidgets.topSites")}</Title>
      {sites.length ? <SiteTiles sites={sites} width={width} actions={actions} /> : <Empty>{t("mobile.startWidgets.sitesYouVisitOften")}</Empty>}
    </View>
  );
});

const FavoritesWidget = memo(function FavoritesWidget({ widget, actions, width }: ViewProps<"favorites">) {
  const { favorites: grid, bookmarks, model } = useBrowserState();
  const recent = useMemo(
    () => [...bookmarks].reverse().slice(0, widget.options.count).map((bookmark) => ({ url: bookmark.url, title: bookmark.title || displayUrl(bookmark.url) })),
    [bookmarks, widget.options.count],
  );
  return (
    <View style={styles.section}>
      {grid.length > 0 && (
        <FavoritesRow
          title={t("mobile.startWidgets.favoritesGrid")}
          favorites={grid}
          isOpen={(url) => model.tabs.some((tab) => tab.spaceId === model.activeSpaceId && isFavoriteTab(url, tab.url))}
          onOpen={actions.onOpenFavorite}
          onLongPress={actions.onFavoriteMenu}
        />
      )}
      <Title>{t("mobile.startWidgets.favorites")}</Title>
      {recent.length ? <SiteTiles sites={recent} width={width} actions={actions} /> : <Empty>{t("mobile.startWidgets.addFavoritesFromPages")}</Empty>}
    </View>
  );
});

const DevicesWidget = memo(function DevicesWidget({ widget, actions }: ViewProps<"devices">) {
  const { colors } = useTheme();
  const { sync } = useBrowserState();
  const devices = (sync?.devices ?? []).filter((device) => device.tabs.length > 0);
  return (
    <View style={styles.section}>
      <Title>{t("mobile.startWidgets.otherDevices")}</Title>
      {devices.length === 0 && (
        <Empty>{sync?.configured ? t("mobile.startWidgets.noTabsOpenOther") : t("mobile.startWidgets.turnSyncFindOther")}</Empty>
      )}
      {devices.map((device) => (
        <View key={device.id} style={styles.device}>
          <View style={styles.row}>
            <Icon name={device.kind === "mobile" ? "smartphone" : "laptop"} size={14} color={colors.accentText} />
            <Text style={[styles.deviceName, { color: colors.textMuted }]} numberOfLines={1}>
              {device.name}
            </Text>
          </View>
          {device.tabs.slice(0, widget.options.count).map((tab, index) => (
            <Tap key={`${index}-${tab.url}`} accessibilityRole="link" onPress={() => actions.onOpen(tab.url)} pressScale={0.98} style={styles.row}>
              <SiteIcon url={tab.url} title={tab.title} size={18} />
              <Text style={[styles.rowText, { color: colors.text }]} numberOfLines={1}>
                {tab.title || displayUrl(tab.url)}
              </Text>
            </Tap>
          ))}
        </View>
      ))}
    </View>
  );
});

const NotesWidget = memo(function NotesWidget({ widget, actions }: ViewProps<"notes">) {
  const { colors, dark, isPrivate } = useTheme();
  const [text, setText] = useState(widget.options.text);
  // Another device or the settings changed the notes while not typing here.
  useEffect(() => setText(widget.options.text), [widget.options.text]);
  return (
    <View style={styles.section}>
      <Title>{t("mobile.startWidgets.notes")}</Title>
      <TextInput
        value={text}
        onChangeText={(value) => {
          setText(value);
          actions.setOptions(widget.id, { text: value }, true);
        }}
        multiline
        maxLength={LIMITS.notes}
        placeholder={isPrivate ? t("mobile.startWidgets.notKeptPrivateBrowsing") : t("mobile.startWidgets.ideaAddressList")}
        placeholderTextColor={colors.textFaint}
        keyboardAppearance={dark ? "dark" : "light"}
        accessibilityLabel={t("mobile.startWidgets.quickNotes")}
        style={[styles.notes, { color: colors.text, backgroundColor: colors.surface }]}
        testID="start-notes"
      />
    </View>
  );
});

const TodoWidget = memo(function TodoWidget({ widget, actions }: ViewProps<"todo">) {
  const { colors, dark } = useTheme();
  const [draft, setDraft] = useState("");
  const items = widget.options.items;
  const shown = widget.options.hideDone ? items.filter((item) => !item.done) : items;
  const save = (next: typeof items) => actions.setOptions(widget.id, { items: next });
  return (
    <View style={styles.section}>
      <Title>{t("mobile.startWidgets.do")}</Title>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => {
          save(addTodo(items, draft));
          setDraft("");
        }}
        maxLength={LIMITS.todoText}
        placeholder={t("mobile.startWidgets.addTask")}
        placeholderTextColor={colors.textFaint}
        keyboardAppearance={dark ? "dark" : "light"}
        returnKeyType="done"
        submitBehavior="submit"
        accessibilityLabel={t("mobile.startWidgets.newTask")}
        style={[styles.field, { color: colors.text, backgroundColor: colors.surface }]}
      />
      {shown.map((item) => (
        <View key={item.id} style={styles.row}>
          <Tap
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.done }}
            accessibilityLabel={item.text}
            onPress={() => save(toggleTodo(items, item.id))}
            style={[styles.row, { flex: 1 }]}
          >
            <View style={[styles.check, { borderColor: item.done ? colors.accent : colors.textFaint, backgroundColor: item.done ? colors.accent : "transparent" }]}>
              {item.done && <Icon name="check" size={12} color={colors.onAccent} strokeWidth={3} />}
            </View>
            <Text style={[styles.rowText, { color: item.done ? colors.textFaint : colors.text, textDecorationLine: item.done ? "line-through" : "none" }]}>
              {item.text}
            </Text>
          </Tap>
          <Tap accessibilityRole="button" accessibilityLabel={t("mobile.startWidgets.delete", { text: item.text })} onPress={() => save(removeTodo(items, item.id))} style={styles.remove}>
            <Icon name="close" size={14} color={colors.textFaint} />
          </Tap>
        </View>
      ))}
      {items.some((item) => item.done) && (
        <Tap accessibilityRole="button" onPress={() => save(clearDoneTodos(items))}>
          <Text style={[styles.link, { color: colors.textMuted }]}>{t("mobile.startWidgets.clearCompletedTasks")}</Text>
        </Tap>
      )}
    </View>
  );
});

const WeatherWidget = memo(function WeatherWidget({ widget, actions }: ViewProps<"weather">) {
  const { colors, dark } = useTheme();
  const place = widget.options.place;
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeatherPlace[] | null>(null);

  useEffect(() => {
    setForecast(null);
    setFailed(false);
    if (!place) return;
    let live = true;
    weather.forecast(place.latitude, place.longitude).then((result) => {
      if (!live) return;
      setForecast(result);
      setFailed(!result);
    });
    return () => {
      live = false;
    };
  }, [place]);

  if (!place) {
    return (
      <View style={styles.section}>
        <Title>{t("mobile.startWidgets.weather")}</Title>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void weather.places(query).then(setResults)}
          placeholder={t("mobile.startWidgets.city")}
          placeholderTextColor={colors.textFaint}
          keyboardAppearance={dark ? "dark" : "light"}
          returnKeyType="search"
          accessibilityLabel={t("mobile.startWidgets.weatherCity")}
          style={[styles.field, { color: colors.text, backgroundColor: colors.surface }]}
        />
        {results?.length === 0 && <Empty>{t("mobile.startWidgets.noCityFoundNo")}</Empty>}
        {results?.map((result, index) => (
          <Tap key={index} accessibilityRole="button" onPress={() => actions.setOptions(widget.id, { place: result })} style={styles.row}>
            <Icon name="map-pin" size={14} color={colors.textMuted} />
            <Text style={[styles.rowText, { color: colors.text }]} numberOfLines={1}>
              {result.name} <Text style={{ color: colors.textFaint }}>{result.region}</Text>
            </Text>
          </Tap>
        ))}
        {!results && <Empty>{t("mobile.startWidgets.forecastsFromOpenMeteo")}</Empty>}
      </View>
    );
  }
  const condition = forecast ? weatherCondition(forecast.code, forecast.isDay) : null;
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Icon name={condition?.icon ?? "cloud"} size={32} color={colors.accentText} />
        <View>
          {forecast && <Text style={[styles.temp, { color: colors.text }]}>{formatTemperature(forecast.temperature, widget.options.unit)}</Text>}
          <Text style={[styles.rowText, { color: colors.textMuted }]} numberOfLines={1}>
            {place.name} · {condition?.label ?? (failed ? t("mobile.startWidgets.weatherUnavailable") : "Chargement…")}
          </Text>
        </View>
      </View>
      {widget.size !== "s" && forecast && (
        <View style={styles.days}>
          {forecast.days.slice(1, 4).map((day) => (
            <View key={day.date} style={[styles.day, { backgroundColor: colors.surface }]}>
              <Text style={[styles.dayText, { color: colors.textMuted }]}>{forecastWeekday(day.date)}</Text>
              <Icon name={weatherCondition(day.code).icon} size={16} color={colors.text} />
              <Text style={[styles.dayText, { color: colors.text }]}>
                {formatTemperature(day.max, widget.options.unit)} {formatTemperature(day.min, widget.options.unit)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 6, paddingVertical: 8 },
  time: { fontSize: 15, fontWeight: "600", letterSpacing: 0.5, fontVariant: ["tabular-nums"] },
  greeting: { fontSize: 34, fontWeight: "800", letterSpacing: -0.6, textAlign: "center" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 54,
    width: "100%",
    borderRadius: 27,
    paddingHorizontal: 20,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  searchText: { fontSize: 16, flex: 1 },
  section: { gap: 10 },
  title: { fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  empty: { fontSize: 14, lineHeight: 19 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { alignItems: "center", gap: 6 },
  tileIcon: { borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  tileLabel: { fontSize: 12, fontWeight: "500", maxWidth: "100%" },
  device: { gap: 4 },
  deviceName: { fontSize: 13, fontWeight: "600", flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36 },
  rowText: { fontSize: 15, flexShrink: 1 },
  notes: { minHeight: 110, borderRadius: 12, padding: 12, fontSize: 15, lineHeight: 21, textAlignVertical: "top" },
  field: { height: 42, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  remove: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  link: { fontSize: 13, paddingVertical: 4 },
  temp: { fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  days: { flexDirection: "row", gap: 6 },
  day: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 8, borderRadius: 12 },
  dayText: { fontSize: 12 },
});
