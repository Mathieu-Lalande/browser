import { hashValue } from "./hash";
import { compareHlc, isHlc } from "./hlc";

/**
 * Field-level last-writer-wins (ADR-057), pure. A collection may name top-level fields that are
 * merged one by one: each carries the timestamp of its last change, so a bookmark renamed on one
 * device while it is moved to another folder on a second keeps both edits, instead of the newer
 * record replacing the whole older one. Other fields follow the record's newest side.
 */

/** Field → HLC of its last change. */
export type FieldClocks = Record<string, string>;

const valueOf = (data: unknown, field: string): unknown => (typeof data === "object" && data !== null ? (data as Record<string, unknown>)[field] : undefined);

/** A hash per field (a missing field hashes like `null`). */
export function fieldHashes(data: unknown, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, hashValue(valueOf(data, field) ?? null)]));
}

/**
 * The field clocks after a local change stamped `hlc`: the fields whose hash changed (all of them
 * for a new record) take `hlc`, the others keep their clock (or `fallback`, the record's previous one).
 */
export function touchedFieldClocks(
  fields: readonly string[],
  before: { hashes?: Record<string, string>; clocks?: FieldClocks; fallback?: string } | null,
  after: Record<string, string>,
  hlc: string,
): FieldClocks {
  const clocks: FieldClocks = {};
  for (const field of fields) {
    const same = before?.hashes?.[field] !== undefined && before.hashes[field] === after[field];
    const kept = before?.clocks?.[field] ?? before?.fallback;
    clocks[field] = same && kept && isHlc(kept) ? kept : hlc;
  }
  return clocks;
}

/** Field clocks read from another device (validated); a field without one has the record's `fallback`. */
export function parseFieldClocks(value: unknown, fields: readonly string[], fallback: string): FieldClocks {
  const raw = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const clocks: FieldClocks = {};
  for (const field of fields) {
    const clock = raw[field];
    // A field cannot claim a change later than its record.
    clocks[field] = isHlc(clock) && compareHlc(clock, fallback) <= 0 ? clock : fallback;
  }
  return clocks;
}

export interface FieldMerge<T> {
  data: T;
  clocks: FieldClocks;
  /** Some field kept the local value over a newer remote record (the merge must go back up). */
  keptLocal: boolean;
  /** Some field took the remote value (the merge must be applied here). */
  tookRemote: boolean;
}

/**
 * Merges a local and a remote version of one record field by field: each field takes the side
 * whose clock is newer (equal clocks: the same write, the remote side). Fields not listed come from
 * the side with the newer record (`localHlc` against `remoteHlc`).
 */
export function mergeFields<T>(fields: readonly string[], local: T, localClocks: FieldClocks, localHlc: string, remote: T, remoteClocks: FieldClocks, remoteHlc: string): FieldMerge<T> {
  const localNewer = compareHlc(localHlc, remoteHlc) > 0;
  const data = { ...((localNewer ? local : remote) as Record<string, unknown>) };
  const clocks: FieldClocks = {};
  let keptLocal = false;
  let tookRemote = false;
  for (const field of fields) {
    const mine = localClocks[field] ?? localHlc;
    const theirs = remoteClocks[field] ?? remoteHlc;
    const useLocal = compareHlc(mine, theirs) > 0;
    const value = valueOf(useLocal ? local : remote, field);
    if (value === undefined) delete data[field];
    else data[field] = value;
    clocks[field] = useLocal ? mine : theirs;
    const differs = hashValue(valueOf(local, field) ?? null) !== hashValue(valueOf(remote, field) ?? null);
    if (differs && useLocal) keptLocal = true;
    if (differs && !useLocal) tookRemote = true;
  }
  if (!localNewer) {
    // The remote record is newer: its own (unlisted) fields came along; a listed field kept locally goes back up.
    tookRemote ||= hashValue(withoutFields(local, fields)) !== hashValue(withoutFields(remote, fields));
  } else {
    keptLocal ||= hashValue(withoutFields(local, fields)) !== hashValue(withoutFields(remote, fields));
  }
  return { data: data as T, clocks, keptLocal, tookRemote };
}

function withoutFields(data: unknown, fields: readonly string[]): unknown {
  if (typeof data !== "object" || data === null) return data;
  const rest = { ...(data as Record<string, unknown>) };
  for (const field of fields) delete rest[field];
  return rest;
}
