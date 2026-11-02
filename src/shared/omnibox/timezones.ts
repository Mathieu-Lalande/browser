import { fold } from "../fuzzy";

/** "heure à Tokyo", "quelle heure est-il à New York ?", "time in London": local time of a place. */

/** Places (folded names) → IANA time zone. Cities first; a few countries with a single zone. */
const PLACES: Record<string, string> = {
  paris: "Europe/Paris",
  france: "Europe/Paris",
  lyon: "Europe/Paris",
  marseille: "Europe/Paris",
  bruxelles: "Europe/Brussels",
  brussels: "Europe/Brussels",
  belgique: "Europe/Brussels",
  geneve: "Europe/Zurich",
  zurich: "Europe/Zurich",
  suisse: "Europe/Zurich",
  londres: "Europe/London",
  london: "Europe/London",
  "royaume-uni": "Europe/London",
  dublin: "Europe/Dublin",
  lisbonne: "Europe/Lisbon",
  lisbon: "Europe/Lisbon",
  madrid: "Europe/Madrid",
  espagne: "Europe/Madrid",
  barcelone: "Europe/Madrid",
  rome: "Europe/Rome",
  italie: "Europe/Rome",
  berlin: "Europe/Berlin",
  allemagne: "Europe/Berlin",
  amsterdam: "Europe/Amsterdam",
  vienne: "Europe/Vienna",
  athenes: "Europe/Athens",
  istanbul: "Europe/Istanbul",
  moscou: "Europe/Moscow",
  moscow: "Europe/Moscow",
  helsinki: "Europe/Helsinki",
  stockholm: "Europe/Stockholm",
  oslo: "Europe/Oslo",
  varsovie: "Europe/Warsaw",
  "le caire": "Africa/Cairo",
  caire: "Africa/Cairo",
  cairo: "Africa/Cairo",
  casablanca: "Africa/Casablanca",
  maroc: "Africa/Casablanca",
  alger: "Africa/Algiers",
  tunis: "Africa/Tunis",
  dakar: "Africa/Dakar",
  abidjan: "Africa/Abidjan",
  johannesburg: "Africa/Johannesburg",
  nairobi: "Africa/Nairobi",
  dubai: "Asia/Dubai",
  "new delhi": "Asia/Kolkata",
  delhi: "Asia/Kolkata",
  bombay: "Asia/Kolkata",
  mumbai: "Asia/Kolkata",
  inde: "Asia/Kolkata",
  bangkok: "Asia/Bangkok",
  singapour: "Asia/Singapore",
  singapore: "Asia/Singapore",
  "hong kong": "Asia/Hong_Kong",
  pekin: "Asia/Shanghai",
  beijing: "Asia/Shanghai",
  shanghai: "Asia/Shanghai",
  chine: "Asia/Shanghai",
  seoul: "Asia/Seoul",
  tokyo: "Asia/Tokyo",
  japon: "Asia/Tokyo",
  sydney: "Australia/Sydney",
  melbourne: "Australia/Melbourne",
  auckland: "Pacific/Auckland",
  noumea: "Pacific/Noumea",
  papeete: "Pacific/Tahiti",
  tahiti: "Pacific/Tahiti",
  honolulu: "Pacific/Honolulu",
  "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  vancouver: "America/Vancouver",
  denver: "America/Denver",
  chicago: "America/Chicago",
  mexico: "America/Mexico_City",
  "new york": "America/New_York",
  "new-york": "America/New_York",
  washington: "America/New_York",
  boston: "America/New_York",
  miami: "America/New_York",
  toronto: "America/Toronto",
  montreal: "America/Toronto",
  quebec: "America/Toronto",
  "pointe-a-pitre": "America/Guadeloupe",
  guadeloupe: "America/Guadeloupe",
  "fort-de-france": "America/Martinique",
  martinique: "America/Martinique",
  cayenne: "America/Cayenne",
  "saint-denis": "Indian/Reunion",
  reunion: "Indian/Reunion",
  "la reunion": "Indian/Reunion",
  "sao paulo": "America/Sao_Paulo",
  "rio de janeiro": "America/Sao_Paulo",
  "buenos aires": "America/Argentina/Buenos_Aires",
  bogota: "America/Bogota",
  lima: "America/Lima",
  santiago: "America/Santiago",
  utc: "UTC",
  gmt: "UTC",
};

const PATTERN =
  /^(?:quelle\s+)?heure(?:\s+est[- ]il)?(?:\s+(?:a|au|aux|en|de|du|pour))?\s+(.+?)\s*\??$|^(?:what\s+)?time(?:\s+is\s+it)?\s+in\s+(.+?)\s*\??$/;

export interface PlaceTime {
  place: string;
  timeZone: string;
  /** "15:42". */
  time: string;
  /** "lundi 2 novembre". */
  date: string;
  /** "UTC+9", "UTC−3:30", "UTC". */
  offset: string;
}

/** Minutes between the zone's wall clock and UTC at `now`. */
function offsetMinutes(timeZone: string, now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return Math.round((wall - Math.floor(now / 60000) * 60000) / 60000);
}

function formatOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const rest = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/** The local time of the place named in `input`, or null when it is not a time question or the place is unknown. */
export function placeTime(input: string, now: number): PlaceTime | null {
  const match = PATTERN.exec(fold(input.trim()));
  if (!match) return null;
  const name = (match[1] ?? match[2]).replace(/^(?:la|le|les|l')\s*/, "").trim();
  const timeZone = PLACES[name] ?? PLACES[name.replace(/-/g, " ")];
  if (!timeZone) return null;
  try {
    const date = new Date(now);
    const time = new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    const day = new Intl.DateTimeFormat("fr-FR", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(date);
    const original = input.trim();
    // The place as typed (its case and accents), from the folded match position.
    const start = fold(original).lastIndexOf(name);
    const place = start >= 0 ? original.slice(start, start + name.length) : name;
    return { place: place.charAt(0).toUpperCase() + place.slice(1), timeZone, time, date: day, offset: formatOffset(offsetMinutes(timeZone, now)) };
  } catch {
    return null;
  }
}
