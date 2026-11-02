import { describe, expect, it } from "vitest";
import { parseBaseConversion } from "./bases";
import { placeTime } from "./timezones";
import { convert, findUnit, parseConversion } from "./units";

const close = (input: string) => parseConversion(input)?.result;

describe("unit conversions", () => {
  it.each([
    ["10 km en miles", 6.21371192],
    ["1 mi en km", 1.609344],
    ["12 in en cm", 30.48],
    ["6 pieds en m", 1.8288],
  ])("length: %s", (input, expected) => expect(close(input)).toBeCloseTo(expected, 6));

  it.each([
    ["1 kg en lb", 2.20462262],
    ["16 oz en g", 453.59237],
    ["2,5 tonnes en kg", 2500],
  ])("mass: %s", (input, expected) => expect(close(input)).toBeCloseTo(expected, 6));

  it.each([
    ["100 °C en °F", 212],
    ["32 f en c", 0],
    ["0 K en °C", -273.15],
    ["20 celsius en kelvin", 293.15],
  ])("temperature: %s", (input, expected) => expect(close(input)).toBeCloseTo(expected, 6));

  it.each([
    ["1 gal en l", 3.785411784],
    ["50 cl en ml", 500],
    ["1 m3 en litres", 1000],
  ])("volume: %s", (input, expected) => expect(close(input)).toBeCloseTo(expected, 6));

  it.each([
    ["100 km/h en mph", 62.1371192],
    ["10 m/s en km/h", 36],
    ["1 nœud en km/h", 1.852],
  ])("speed: %s", (input, expected) => expect(close(input)).toBeCloseTo(expected, 6));

  it.each([
    ["1 Go en Mo", 1000],
    ["1 GiB en MiB", 1024],
    ["8 bits en o", 1],
    ["100 Mbit en Mo", 12.5],
    ["1 To en Gio", 931.322574615],
  ])("data: %s", (input, expected) => expect(close(input)).toBeCloseTo(expected, 6));

  it("tells bits from bytes by case, and refuses ambiguous spellings", () => {
    expect(findUnit("MB")?.symbol).toBe("Mo");
    expect(findUnit("Mb")?.symbol).toBe("Mbit");
    expect(findUnit("mb")).toBeNull();
    expect(findUnit("KILOMÈTRES")?.symbol).toBe("km");
  });

  it("refuses mixed quantities, unknown units, below absolute zero and non-conversions", () => {
    expect(convert(1, "kg", "km")).toBeNull();
    expect(parseConversion("10 km en parsecs")).toBeNull();
    expect(parseConversion("-300 °C en K")).toBeNull();
    expect(parseConversion("10 km")).toBeNull();
    expect(parseConversion("restaurants en ville")).toBeNull();
    expect(parseConversion("10 km en km")).toBeNull();
  });
});

describe("time zones", () => {
  // 2026-11-02 12:00 UTC.
  const now = Date.UTC(2026, 10, 2, 12, 0);

  it("answers the local time of a city or country, French or English", () => {
    expect(placeTime("heure à Tokyo", now)).toMatchObject({ time: "21:00", place: "Tokyo", offset: "UTC+9", timeZone: "Asia/Tokyo" });
    expect(placeTime("Quelle heure est-il à New York ?", now)).toMatchObject({ time: "07:00", offset: "UTC−5", place: "New York" });
    expect(placeTime("time in London", now)?.time).toBe("12:00");
    expect(placeTime("heure en Inde", now)).toMatchObject({ time: "17:30", offset: "UTC+5:30" });
    expect(placeTime("heure à Montréal", now)?.timeZone).toBe("America/Toronto");
  });

  it("ignores unknown places and other questions", () => {
    expect(placeTime("heure à Atlantis", now)).toBeNull();
    expect(placeTime("heures supplémentaires", now)).toBeNull();
    expect(placeTime("tokyo", now)).toBeNull();
  });
});

describe("number bases", () => {
  it("converts integers between bases", () => {
    expect(parseBaseConversion("255 en hexa")?.result).toBe("FF");
    expect(parseBaseConversion("10 en binaire")?.result).toBe("1010");
    expect(parseBaseConversion("0xff en décimal")?.result).toBe("255");
    expect(parseBaseConversion("0b1010 en hex")?.result).toBe("A");
    expect(parseBaseConversion("-8 en octal")?.result).toBe("-10");
  });

  it("refuses anything else", () => {
    expect(parseBaseConversion("1.5 en hexa")).toBeNull();
    expect(parseBaseConversion("255 en romain")).toBeNull();
    expect(parseBaseConversion("ff en décimal")).toBeNull();
    expect(parseBaseConversion("99999999999999999999 en hexa")).toBeNull();
  });
});
