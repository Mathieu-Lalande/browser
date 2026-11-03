import { History } from "@shared/history";
import { Store } from "../store";

/** AsyncStorage values must stay small (Android limits a row to ~2 MB); 5 000 is also the synced maximum. */
export const MAX_HISTORY = 5000;

/** The `History` instance is mutable: `version` is bumped on each change, for React and the saves. */
export interface HistoryState {
  history: History;
  version: number;
}

export class HistoryStore extends Store<HistoryState> {
  /** Pages the user deleted from the history (cleared), as opposed to pruned because it is full. */
  readonly #deleted = new Set<string>();

  constructor() {
    super({ history: new History([], MAX_HISTORY), version: 0 });
  }

  get history(): History {
    return this.get().history;
  }

  hydrate(stored: unknown): void {
    this.set(({ version }) => ({ history: new History(History.parse(stored) ?? [], MAX_HISTORY), version: version + 1 }));
  }

  /** The history changed in place (a visit, the sync engine). */
  changed(): void {
    this.set(({ history, version }) => ({ history, version: version + 1 }));
  }

  /** A visit; History ignores revisits within 30 s (called several times per load). */
  recordVisit(url: string, title: string, now: number): void {
    if (this.history.recordVisit(url, now, { title })) this.changed();
  }

  /** "Effacer l'historique": the pages are deleted (also on the other devices, see `isDeleted`). */
  clear(): void {
    for (const entry of this.history.toJSON()) this.#deleted.add(entry.url);
    this.history.clear();
    this.changed();
  }

  isDeleted(url: string): boolean {
    return this.#deleted.has(url);
  }
}
