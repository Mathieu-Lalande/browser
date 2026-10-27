import type { RemoteTabInput } from "@shared/palette";
import type { SyncStatus } from "@shared/sync/controller";

/** Reactive mirror of the sync status (ADR-018), pushed by main on every change. */
class SyncStore {
  status = $state<SyncStatus | null>(null);

  constructor() {
    window.browser.sync.onChanged((status) => (this.status = status));
    window.browser.sync.status().then((status) => (this.status ??= status), () => {});
  }

  /** Other devices' tabs, flattened for the palette (most recently updated device first). */
  get remoteTabs(): RemoteTabInput[] {
    return (this.status?.devices ?? []).flatMap((device) => device.tabs.map((tab) => ({ device: device.name, url: tab.url, title: tab.title })));
  }
}

export const sync = new SyncStore();
