/**
 * Hybrid logical clock (Kulkarni et al.): wall-clock milliseconds plus a counter, so timestamps
 * follow real time when clocks agree and still move forward (causally) when they do not.
 *
 * Encoded as a fixed-width string `wall:counter:device` (base 36), so plain string comparison is
 * the total order used by last-writer-wins: time first, then counter, then device id (tiebreak).
 */

export interface Hlc {
  /** Epoch milliseconds. */
  wall: number;
  counter: number;
  /** Device id: breaks ties between two devices writing in the same millisecond. */
  node: string;
}

const WALL_WIDTH = 9; // base 36: up to year 5188
const COUNTER_WIDTH = 4; // 36^4 events per millisecond
const MAX_COUNTER = 36 ** COUNTER_WIDTH - 1;
/** Remote clocks further in the future than this are clamped (a broken clock must not freeze ours). */
export const MAX_DRIFT_MS = 24 * 60 * 60 * 1000;

const NODE_PATTERN = /^[0-9a-z]{1,32}$/;

export const isDeviceId = (value: unknown): value is string => typeof value === "string" && NODE_PATTERN.test(value);

export function encodeHlc(hlc: Hlc): string {
  return `${hlc.wall.toString(36).padStart(WALL_WIDTH, "0")}:${hlc.counter.toString(36).padStart(COUNTER_WIDTH, "0")}:${hlc.node}`;
}

const HLC_PATTERN = new RegExp(`^([0-9a-z]{${WALL_WIDTH}}):([0-9a-z]{${COUNTER_WIDTH}}):([0-9a-z]{1,32})$`);

export function decodeHlc(text: unknown): Hlc | null {
  if (typeof text !== "string") return null;
  const match = HLC_PATTERN.exec(text);
  if (!match) return null;
  return { wall: parseInt(match[1], 36), counter: parseInt(match[2], 36), node: match[3] };
}

export const isHlc = (value: unknown): value is string => decodeHlc(value) !== null;

/** Total order of encoded timestamps: negative, zero or positive like `Array.sort`. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A clock for `node`, at its last known timestamp (or zero). */
export function createClock(node: string, last?: string): Hlc {
  const decoded = last ? decodeHlc(last) : null;
  return { wall: decoded?.wall ?? 0, counter: decoded?.counter ?? 0, node };
}

/** Timestamp for a local event: never smaller than any timestamp seen before. */
export function tick(clock: Hlc, now: number): Hlc {
  const wall = Math.max(clock.wall, Math.floor(now));
  const counter = wall === clock.wall ? clock.counter + 1 : 0;
  if (counter > MAX_COUNTER) return { wall: wall + 1, counter: 0, node: clock.node };
  return { wall, counter, node: clock.node };
}

/** Merges a timestamp received from another device, so our next events order after it. */
export function receive(clock: Hlc, remote: Hlc, now: number): Hlc {
  // Clamp absurd future timestamps instead of jumping our clock years ahead.
  const remoteWall = Math.min(remote.wall, Math.floor(now) + MAX_DRIFT_MS);
  const remoteCounter = remote.wall === remoteWall ? remote.counter : 0;
  const wall = Math.max(clock.wall, remoteWall, Math.floor(now));
  let counter: number;
  if (wall === clock.wall && wall === remoteWall) counter = Math.max(clock.counter, remoteCounter) + 1;
  else if (wall === clock.wall) counter = clock.counter + 1;
  else if (wall === remoteWall) counter = remoteCounter + 1;
  else counter = 0;
  if (counter > MAX_COUNTER) return { wall: wall + 1, counter: 0, node: clock.node };
  return { wall, counter, node: clock.node };
}
