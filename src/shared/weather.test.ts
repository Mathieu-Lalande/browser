import { describe, expect, it, vi } from "vitest";
import { WEATHER_CACHE_MS, WeatherClient, forecastUrl, formatTemperature, geocodingUrl, parseForecast, parsePlaces, weatherCondition } from "./weather";

const FORECAST = {
  latitude: 48.86,
  longitude: 2.34,
  current: { time: "2026-11-02T10:00", temperature_2m: 11.6, weather_code: 61, is_day: 1 },
  daily: {
    time: ["2026-11-02", "2026-11-03", "bad"],
    weather_code: [61, 3, 0],
    temperature_2m_max: [13.1, 12, 10],
    temperature_2m_min: [7.4, "x", 2],
  },
};

describe("weather (Open-Meteo)", () => {
  it("builds the request URLs", () => {
    expect(geocodingUrl("  Saint-Étienne ")).toBe("https://geocoding-api.open-meteo.com/v1/search?name=Saint-%C3%89tienne&count=6&language=fr&format=json");
    const url = new URL(forecastUrl(48.8566, 2.3522));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("48.8566");
    expect(url.searchParams.get("current")).toBe("temperature_2m,weather_code,is_day");
  });

  it("parses places, skipping malformed results", () => {
    const places = parsePlaces({
      results: [
        { name: "Paris", latitude: 48.85341, longitude: 2.3488, country: "France", admin1: "Île-de-France" },
        { name: "Paris", latitude: 33.66, longitude: -95.55, country: "États-Unis" },
        { name: "", latitude: 1, longitude: 1 },
        { name: "Mars", latitude: 300, longitude: 1 },
        "junk",
      ],
    });
    expect(places).toEqual([
      { name: "Paris", region: "Île-de-France, France", latitude: 48.8534, longitude: 2.3488 },
      { name: "Paris", region: "États-Unis", latitude: 33.66, longitude: -95.55 },
    ]);
    expect(parsePlaces({})).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
  });

  it("parses a forecast, refusing one without current conditions", () => {
    expect(parseForecast(FORECAST)).toEqual({
      temperature: 11.6,
      code: 61,
      isDay: true,
      days: [{ date: "2026-11-02", min: 7.4, max: 13.1, code: 61 }],
    });
    expect(parseForecast({ current: { temperature_2m: "warm", weather_code: 1 } })).toBeNull();
    expect(parseForecast({ error: true, reason: "Invalid" })).toBeNull();
  });

  it("labels weather codes and formats temperatures", () => {
    expect(weatherCondition(0)).toEqual({ label: "Ciel dégagé", icon: "sun" });
    expect(weatherCondition(0, false).icon).toBe("moon");
    expect(weatherCondition(63).icon).toBe("cloud-rain");
    expect(weatherCondition(75).label).toBe("Neige");
    expect(weatherCondition(99).icon).toBe("cloud-lightning");
    expect(formatTemperature(11.6, "c")).toBe("12°");
    expect(formatTemperature(0, "f")).toBe("32°");
  });

  it("caches answers for 30 minutes, and retries after a failure", async () => {
    let now = 0;
    const fetchJson = vi.fn(async (url: string) => (url.includes("forecast") ? FORECAST : { results: [] }));
    const client = new WeatherClient(fetchJson, () => now);
    await client.forecast(48.8566, 2.3522);
    await client.forecast(48.8566, 2.3522);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    now += WEATHER_CACHE_MS;
    await client.forecast(48.8566, 2.3522);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(await client.forecast(120, 0)).toBeNull();
    expect(await client.places("a")).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(2);

    fetchJson.mockRejectedValueOnce(new Error("offline"));
    expect(await client.places("Lyon")).toEqual([]);
    await client.places("Lyon");
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });
});
