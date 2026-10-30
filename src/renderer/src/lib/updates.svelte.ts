import type { UpdateStatus } from "@shared/updates";

/** Reactive mirror of the auto-update status (ADR-030), pushed by main on every change. */
class UpdatesStore {
  status = $state<UpdateStatus | null>(null);

  constructor() {
    window.browser.updates.onChanged((status) => (this.status = status));
    window.browser.updates.status().then((status) => (this.status ??= status), () => {});
  }

  get ready(): boolean {
    return this.status?.phase === "ready";
  }
}

export const updates = new UpdatesStore();
