import { useSyncExternalStore } from "react";

/**
 * A value outside React that components subscribe to (`useStore`). Reads are always current:
 * code that writes (an action, the sync engine) reads its own write back at once.
 */
export class Store<T> {
  #value: T;
  readonly #listeners = new Set<() => void>();

  constructor(initial: T) {
    this.#value = initial;
  }

  readonly get = (): T => this.#value;

  /** Replaces the value (or derives it from the current one); no-op when it is the same. */
  set(next: T | ((current: T) => T)): void {
    const value = typeof next === "function" ? (next as (current: T) => T)(this.#value) : next;
    if (Object.is(value, this.#value)) return;
    this.#value = value;
    for (const listener of [...this.#listeners]) listener();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

/** The store's current value, re-rendering when it changes. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
