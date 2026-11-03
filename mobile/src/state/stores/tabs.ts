import { addArchived, removeArchived, sanitizeArchive, type ArchivedTab } from "@shared/archive";
import { parseSession, initialTabsModel, tabsReducer, type TabsAction, type TabsModel } from "../../lib/tabs";
import { Store } from "../store";

/** Open tabs, spaces and folders (`lib/tabs` reducer), saved as the session. */
export class TabsStore extends Store<TabsModel> {
  constructor() {
    super(initialTabsModel());
  }

  dispatch(action: TabsAction): void {
    this.set((model) => tabsReducer(model, action));
  }

  /** The stored session, restored when the setting asks for it. */
  hydrate(session: unknown, restore: boolean): void {
    const restored = restore ? parseSession(session) : null;
    if (restored) this.dispatch({ type: "restore", model: restored });
  }
}

/** Archived tabs (ADR-022): closed by the idle timer, restorable from the overview. */
export class ArchiveStore extends Store<ArchivedTab[]> {
  constructor() {
    super([]);
  }

  hydrate(stored: unknown): void {
    this.set(sanitizeArchive(stored));
  }

  add(entries: ArchivedTab[]): void {
    this.set((list) => addArchived(list, entries));
  }

  remove(id: string): void {
    this.set((list) => removeArchived(list, id));
  }

  clear(): void {
    this.set([]);
  }
}
