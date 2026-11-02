import type { Bounds } from "@shared/types";

/**
 * Argument guards of the IPC tables (`./registry`): each one is a type guard, so a handler's
 * parameter types are inferred from its validators (no casts). Pure: also used outside IPC to
 * check stored data.
 */

export type Guard<T> = (value: unknown) => value is T;
export type Guarded<G> = G extends Guard<infer T> ? T : never;

export const str: Guard<string> = (value): value is string => typeof value === "string";
export const bool: Guard<boolean> = (value): value is boolean => typeof value === "boolean";
/** A finite number. */
export const num: Guard<number> = (value): value is number => typeof value === "number" && Number.isFinite(value);
export const int: Guard<number> = (value): value is number => Number.isInteger(value);

/** A string of at most `max` characters. */
export const maxStr =
  (max: number): Guard<string> =>
  (value): value is string =>
    str(value) && value.length <= max;
/** A non-empty string of at most `max` characters. */
export const text =
  (max: number): Guard<string> =>
  (value): value is string =>
    str(value) && value.length > 0 && value.length <= max;
/** An integer in `min…max`. */
export const intIn =
  (min: number, max: number): Guard<number> =>
  (value): value is number =>
    int(value) && value >= min && value <= max;

export const opt =
  <T>(guard: Guard<T>): Guard<T | undefined> =>
  (value): value is T | undefined =>
    value === undefined || guard(value);
export const nullable =
  <T>(guard: Guard<T>): Guard<T | null> =>
  (value): value is T | null =>
    value === null || guard(value);
export const oneOf =
  <const T extends readonly unknown[]>(...values: T): Guard<T[number]> =>
  (value): value is T[number] =>
    values.includes(value);
export const arrayOf =
  <T>(guard: Guard<T>, max: number): Guard<T[]> =>
  (value): value is T[] =>
    Array.isArray(value) && value.length <= max && value.every(guard);

/** A plain object (not an array), optionally under `maxJson` characters as JSON: its content is checked by the callee. */
export const record =
  (maxJson?: number): Guard<Record<string, unknown>> =>
  (value): value is Record<string, unknown> =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (maxJson === undefined || JSON.stringify(value).length <= maxJson);

/** Adopts a boolean predicate as the guard of `T` (domain checks that are not type guards). */
export const custom =
  <T>(predicate: (value: unknown) => boolean): Guard<T> =>
  (value): value is T =>
    predicate(value);

export const bounds: Guard<Bounds> = (value): value is Bounds => {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return num(b.x) && num(b.y) && num(b.width) && num(b.height);
};
