import { sanitizePlace, type TemperatureUnit, type WeatherPlace } from "./start-widgets";

/**
 * Weather widget (ADR-034): Open-Meteo, free and without an API key. Pure: the request URLs,
 * the response parsers (any JSON is untrusted) and a client with a 30 min cache whose HTTP
 * fetcher is injected (main's in-memory session on the desktop, `fetch` on the phone).
 */

export const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
export const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
export const WEATHER_CACHE_MS = 30 * 60_000;
export const WEATHER_TIMEOUT_MS = 8_000;
export const MAX_PLACE_QUERY = 100;

export type WeatherIcon = "sun" | "moon" | "cloud-sun" | "cloud-moon" | "cloud" | "cloud-fog" | "cloud-drizzle" | "cloud-rain" | "cloud-snow" | "cloud-lightning";

export interface ForecastDay {
  /** `YYYY-MM-DD`, in the place's time zone. */
  date: string;
  min: number;
  max: number;
  code: number;
}

export interface Forecast {
  /** °C. */
  temperature: number;
  code: number;
  isDay: boolean;
  days: ForecastDay[];
}

export function geocodingUrl(query: string): string {
  const params = new URLSearchParams({ name: query.trim().slice(0, MAX_PLACE_QUERY), count: "6", language: "fr", format: "json" });
  return `${GEOCODING_ENDPOINT}?${params}`;
}

export function forecastUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: "temperature_2m,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: "4",
  });
  return `${FORECAST_ENDPOINT}?${params}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Places of a geocoding response (invalid entries skipped). */
export function parsePlaces(json: unknown): WeatherPlace[] {
  if (!isRecord(json) || !Array.isArray(json.results)) return [];
  const places: WeatherPlace[] = [];
  for (const result of json.results.slice(0, 10)) {
    if (!isRecord(result)) continue;
    const region = [result.admin1, result.country].filter((part): part is string => typeof part === "string" && part.length > 0).join(", ");
    const place = sanitizePlace({ name: result.name, region, latitude: result.latitude, longitude: result.longitude });
    if (place) places.push(place);
  }
  return places;
}

/** The forecast of a response, or null when its current conditions are missing or malformed. */
export function parseForecast(json: unknown): Forecast | null {
  if (!isRecord(json) || !isRecord(json.current)) return null;
  const { temperature_2m: temperature, weather_code: code, is_day: isDay } = json.current;
  if (!finite(temperature) || !finite(code)) return null;
  const days: ForecastDay[] = [];
  const daily = isRecord(json.daily) ? json.daily : {};
  const dates = Array.isArray(daily.time) ? daily.time : [];
  const columns = [daily.temperature_2m_min, daily.temperature_2m_max, daily.weather_code].map((column) => (Array.isArray(column) ? column : []));
  dates.slice(0, 7).forEach((date, i) => {
    const [min, max, dayCode] = columns.map((column) => column[i]);
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && finite(min) && finite(max) && finite(dayCode)) days.push({ date, min, max, code: dayCode });
  });
  return { temperature, code, isDay: isDay !== 0, days };
}

/** WMO weather code → French label and icon. */
export function weatherCondition(code: number, isDay = true): { label: string; icon: WeatherIcon } {
  if (code === 0) return { label: "Ciel dégagé", icon: isDay ? "sun" : "moon" };
  if (code <= 2) return { label: "Partiellement nuageux", icon: isDay ? "cloud-sun" : "cloud-moon" };
  if (code === 3) return { label: "Couvert", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Brouillard", icon: "cloud-fog" };
  if (code >= 51 && code <= 57) return { label: "Bruine", icon: "cloud-drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: "Pluie", icon: "cloud-rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: "Neige", icon: "cloud-snow" };
  if (code >= 95) return { label: "Orage", icon: "cloud-lightning" };
  return { label: "Variable", icon: "cloud" };
}

/** "12°" (rounded, in the unit asked; the API answers in °C). */
export function formatTemperature(celsius: number, unit: TemperatureUnit): string {
  const value = unit === "f" ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(value)}°`;
}

/** Short French weekday of a forecast day ("lun."), from its `YYYY-MM-DD` date. */
export function forecastWeekday(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("fr-FR", { weekday: "short" });
}

/** GETs a URL and parses its JSON body; rejects on an HTTP error or a timeout. */
export type FetchJson = (url: string) => Promise<unknown>;

const MAX_CACHE = 24;

/** Open-Meteo with a cache: one request per place (or search) every 30 minutes at most. */
export class WeatherClient {
  private readonly cache = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(
    private readonly fetchJson: FetchJson,
    private readonly now: () => number = Date.now,
  ) {}

  async places(query: string): Promise<WeatherPlace[]> {
    const clean = query.trim().toLowerCase();
    if (clean.length < 2) return [];
    return parsePlaces(await this.cached(`q:${clean}`, geocodingUrl(clean)));
  }

  async forecast(latitude: number, longitude: number): Promise<Forecast | null> {
    if (!finite(latitude) || !finite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return parseForecast(await this.cached(`f:${latitude.toFixed(2)},${longitude.toFixed(2)}`, forecastUrl(latitude, longitude)));
  }

  private cached(key: string, url: string): Promise<unknown> {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < WEATHER_CACHE_MS) return hit.value;
    const value = this.fetchJson(url).catch(() => null);
    const entry = { at: this.now(), value };
    this.cache.set(key, entry);
    // A failure (offline) is not kept: the next widget refresh asks again.
    void value.then((result) => {
      if (result === null && this.cache.get(key) === entry) this.cache.delete(key);
    });
    while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  }
}
