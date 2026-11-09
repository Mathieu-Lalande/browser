import { fold } from "../fuzzy";
import { getLocale } from "../i18n/locale";

/**
 * Offline unit conversions for the universal bar: "10 km en miles", "72 °F en °C", "3 Go en Mo".
 * No currencies (they need live rates, so a network request per keystroke).
 * i18n-ignore-file: the aliases are parsing words, French and English alike (ADR-052).
 */

export type Quantity = "length" | "mass" | "temperature" | "volume" | "speed" | "data";

interface Unit {
  quantity: Quantity;
  /** Display symbol. */
  symbol: string;
  /** Accepted spellings; matched exactly first, then ignoring case and accents if unambiguous. */
  aliases: readonly string[];
  /** Value of one unit in the quantity's base unit (temperature: see `toBase`). */
  factor: number;
}

const u = (quantity: Quantity, symbol: string, factor: number, aliases: string[]): Unit => ({ quantity, symbol, factor, aliases: [symbol, ...aliases] });

const UNITS: readonly Unit[] = [
  // Length, in metres.
  u("length", "mm", 0.001, ["millimètre", "millimètres", "millimetre", "millimeter", "millimeters"]),
  u("length", "cm", 0.01, ["centimètre", "centimètres", "centimetre", "centimeter", "centimeters"]),
  u("length", "m", 1, ["mètre", "mètres", "metre", "metres", "meter", "meters"]),
  u("length", "km", 1000, ["kilomètre", "kilomètres", "kilometre", "kilometres", "kilometer", "kilometers"]),
  u("length", "in", 0.0254, ["pouce", "pouces", "inch", "inches", "″"]),
  u("length", "ft", 0.3048, ["pied", "pieds", "foot", "feet", "′"]),
  u("length", "yd", 0.9144, ["yard", "yards"]),
  u("length", "mi", 1609.344, ["mile", "miles"]),
  u("length", "nmi", 1852, ["mille marin", "milles marins", "nautical mile", "nautical miles"]),
  // Mass, in grams.
  u("mass", "mg", 0.001, ["milligramme", "milligrammes", "milligram", "milligrams"]),
  u("mass", "g", 1, ["gramme", "grammes", "gram", "grams"]),
  u("mass", "kg", 1000, ["kilo", "kilos", "kilogramme", "kilogrammes", "kilogram", "kilograms"]),
  u("mass", "t", 1e6, ["tonne", "tonnes", "ton", "tons"]),
  u("mass", "oz", 28.349523125, ["once", "onces", "ounce", "ounces"]),
  u("mass", "lb", 453.59237, ["lbs", "livre", "livres", "pound", "pounds"]),
  u("mass", "st", 6350.29318, ["stone", "stones"]),
  // Temperature (converted through kelvins).
  u("temperature", "°C", 1, ["c", "°c", "celsius", "degré celsius", "degrés celsius", "degrés", "degré"]),
  u("temperature", "°F", 1, ["f", "°f", "fahrenheit", "degré fahrenheit", "degrés fahrenheit"]),
  u("temperature", "K", 1, ["kelvin", "kelvins"]),
  // Volume, in litres.
  u("volume", "ml", 0.001, ["mL", "millilitre", "millilitres", "milliliter", "milliliters"]),
  u("volume", "cl", 0.01, ["cL", "centilitre", "centilitres"]),
  u("volume", "dl", 0.1, ["dL", "décilitre", "décilitres"]),
  u("volume", "l", 1, ["L", "litre", "litres", "liter", "liters"]),
  u("volume", "m³", 1000, ["m3", "mètre cube", "mètres cubes", "cubic meter", "cubic meters"]),
  u("volume", "gal", 3.785411784, ["gallon", "gallons"]),
  u("volume", "qt", 0.946352946, ["quart", "quarts"]),
  u("volume", "pt", 0.473176473, ["pinte", "pintes", "pint", "pints"]),
  u("volume", "tasse", 0.2365882365, ["tasses", "cup", "cups"]),
  u("volume", "fl oz", 0.0295735295625, ["floz", "fluid ounce", "fluid ounces"]),
  // Speed, in metres per second.
  u("speed", "km/h", 1 / 3.6, ["kmh", "kph", "kilomètres par heure", "kilomètres/heure"]),
  u("speed", "m/s", 1, ["mètres par seconde", "meters per second"]),
  u("speed", "mph", 0.44704, ["miles par heure", "miles per hour", "mi/h"]),
  u("speed", "nœud", 1852 / 3600, ["nœuds", "noeud", "noeuds", "kn", "kt", "knot", "knots"]),
  // Data sizes, in bytes (SI multiples for kB/MB…, binary ones for KiB/MiB…).
  u("data", "o", 1, ["octet", "octets", "B", "byte", "bytes"]),
  u("data", "bit", 1 / 8, ["bits", "b"]),
  u("data", "Ko", 1e3, ["kB", "KB", "kilooctet", "kilooctets", "kilobyte", "kilobytes"]),
  u("data", "Mo", 1e6, ["MB", "mégaoctet", "mégaoctets", "megaoctet", "megabyte", "megabytes"]),
  u("data", "Go", 1e9, ["GB", "gigaoctet", "gigaoctets", "gigabyte", "gigabytes"]),
  u("data", "To", 1e12, ["TB", "téraoctet", "téraoctets", "teraoctet", "terabyte", "terabytes"]),
  u("data", "Kio", 1024, ["KiB", "kibioctet", "kibioctets", "kibibyte"]),
  u("data", "Mio", 1024 ** 2, ["MiB", "mébioctet", "mébioctets", "mebibyte"]),
  u("data", "Gio", 1024 ** 3, ["GiB", "gibioctet", "gibioctets", "gibibyte"]),
  u("data", "Tio", 1024 ** 4, ["TiB", "tébioctet", "tébioctets", "tebibyte"]),
  u("data", "kbit", 1e3 / 8, ["kb", "Kb", "kbits", "kilobit", "kilobits"]),
  u("data", "Mbit", 1e6 / 8, ["Mb", "Mbits", "mégabit", "mégabits", "megabit", "megabits"]),
  u("data", "Gbit", 1e9 / 8, ["Gb", "Gbits", "gigabit", "gigabits"]),
];

/** The unit a spelling names: exact spelling first ("Mb" ≠ "MB"), else case/accent-insensitive if only one unit fits. */
export function findUnit(name: string): Unit | null {
  const text = name.trim();
  const exact = UNITS.find((unit) => unit.aliases.includes(text));
  if (exact) return exact;
  const folded = fold(text);
  const loose = UNITS.filter((unit) => unit.aliases.some((alias) => fold(alias) === folded));
  return loose.length === 1 ? loose[0] : null;
}

/** English symbols of the units French writes its own way ("Mo" → "MB"), ADR-052. */
const ENGLISH_SYMBOLS: Readonly<Record<string, string>> = {
  o: "B",
  Ko: "kB",
  Mo: "MB",
  Go: "GB",
  To: "TB",
  Kio: "KiB",
  Mio: "MiB",
  Gio: "GiB",
  Tio: "TiB",
  tasse: "cup",
  nœud: "kn",
};

/** The symbol shown for a unit in the UI language. */
export function displaySymbol(symbol: string): string {
  return getLocale() === "en" ? (ENGLISH_SYMBOLS[symbol] ?? symbol) : symbol;
}

function toKelvin(value: number, symbol: string): number {
  if (symbol === "°C") return value + 273.15;
  if (symbol === "°F") return ((value - 32) * 5) / 9 + 273.15;
  return value;
}

function fromKelvin(value: number, symbol: string): number {
  if (symbol === "°C") return value - 273.15;
  if (symbol === "°F") return ((value - 273.15) * 9) / 5 + 32;
  return value;
}

export interface Conversion {
  value: number;
  from: string;
  to: string;
  result: number;
  quantity: Quantity;
}

/** Converts between two units of the same quantity; null otherwise (or below absolute zero). */
export function convert(value: number, fromName: string, toName: string): Conversion | null {
  const from = findUnit(fromName);
  const to = findUnit(toName);
  if (!from || !to || from.quantity !== to.quantity || from === to) return null;
  let result: number;
  if (from.quantity === "temperature") {
    const kelvin = toKelvin(value, from.symbol);
    if (kelvin < 0) return null;
    result = fromKelvin(kelvin, to.symbol);
  } else {
    result = (value * from.factor) / to.factor;
  }
  return Number.isFinite(result) ? { value, from: displaySymbol(from.symbol), to: displaySymbol(to.symbol), result, quantity: from.quantity } : null;
}

/** "10 km en miles", "10km → mi", "72 °F to °C", "1,5 Go en Mo". */
const PATTERN = /^(-?\d+(?:[.,]\d+)?)\s*(.+?)\s+(?:en|in|to|vers|→|->|=)\s+(.+?)\s*\??$/i;

/** Parses and converts a conversion request, or null when the text is not one. */
export function parseConversion(input: string): Conversion | null {
  const match = PATTERN.exec(input.trim());
  if (!match) return null;
  return convert(Number(match[1].replace(",", ".")), match[2], match[3]);
}
