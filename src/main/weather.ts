import { session } from "electron";
import { WEATHER_TIMEOUT_MS, WeatherClient } from "@shared/weather";
import { ASSETS_PARTITION } from "./start-image";

/**
 * The weather widget's requests (ADR-034), made by main: the chrome UI's CSP allows no remote
 * connection. They go through the in-memory assets session (no cookies, nothing on disk), with a
 * timeout and the shared client's 30 min cache. Nothing is asked until a weather widget exists.
 */

const MAX_BYTES = 512 * 1024;

async function fetchJson(url: string): Promise<unknown> {
  const response = await session.fromPartition(ASSETS_PARTITION).fetch(url, {
    credentials: "omit",
    signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > MAX_BYTES) throw new Error("Response too large");
  return JSON.parse(body);
}

let client: WeatherClient | null = null;

export function weather(): WeatherClient {
  client ??= new WeatherClient(fetchJson);
  return client;
}
