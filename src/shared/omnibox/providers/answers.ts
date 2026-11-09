import { t } from "../../i18n";
import { BASE_LABELS, parseBaseConversion } from "../bases";
import { decimalOf, evaluate, formatNumber } from "../calculator";
import { placeTime } from "../timezones";
import type { OmniboxIcon, Provider, QueryContext, Suggestion } from "../types";
import { parseConversion } from "../units";

/**
 * Instant answers: computed locally from the text, shown first, Enter copies the result.
 * Never with a scope (they answer the bare text).
 */

const ANSWER_SCORE = 1000;

function answer(id: string, result: string, detail: string, icon: OmniboxIcon): Suggestion[] {
  return [
    {
      key: `answer:${id}`,
      section: "answer",
      title: result,
      titleRanges: [],
      detail,
      detailRanges: [],
      score: ANSWER_SCORE,
      icon,
      verb: t("providersAnswers.copy"),
      completion: result,
      action: { type: "copy", text: result },
    },
  ];
}

/** "2*(3+4)" → 14. */
export class CalculatorProvider implements Provider {
  readonly id = "calculator";

  query(text: string): Suggestion[] {
    const value = evaluate(text);
    if (value === null) return [];
    return answer("calculator", formatNumber(value, decimalOf(text)), `${text.trim().replace(/^=\s*/, "")} =`, "calculator");
  }
}

/** "10 km en miles", "72 °F en °C", "3 Go en Mo". */
export class ConversionProvider implements Provider {
  readonly id = "conversion";

  query(text: string): Suggestion[] {
    const conversion = parseConversion(text);
    if (!conversion) return [];
    const decimal = decimalOf(text);
    const result = `${formatNumber(conversion.result, decimal)} ${conversion.to}`;
    return answer("conversion", result, `${formatNumber(conversion.value, decimal)} ${conversion.from} =`, "ruler");
  }
}

/** "heure à Tokyo". */
export class TimeZoneProvider implements Provider {
  readonly id = "timezone";

  query(text: string, context: QueryContext): Suggestion[] {
    const time = placeTime(text, context.now);
    if (!time) return [];
    return answer("timezone", time.time, `${time.place} · ${time.date} · ${time.offset}`, "clock");
  }
}

/** "255 en hexa", "0xff en binaire". */
export class NumberBaseProvider implements Provider {
  readonly id = "base";

  query(text: string): Suggestion[] {
    const conversion = parseBaseConversion(text);
    if (!conversion) return [];
    return answer("base", conversion.result, t("providersAnswers.in", { input: conversion.input, p: BASE_LABELS[conversion.to] }), "binary");
  }
}
