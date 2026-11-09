import { session } from "electron";
import { panelPartition } from "@shared/panels";

export { PanelHost, type PanelHostDeps } from "./host";
export { PanelService, type PanelStore } from "./service";

/** A removed panel takes its cookies, storage and cache with it (ADR-047). */
export function clearPanelPartition(id: string): void {
  const ses = session.fromPartition(panelPartition(id));
  void Promise.all([ses.clearStorageData(), ses.clearCache()]).catch(() => {});
}
