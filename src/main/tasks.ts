import type { ProcessMetric, WebContents } from "electron";
import { buildTaskRows, type ProcessOwner, type ProcessSample, type TaskRow } from "@shared/tasks";
import type { WindowDirectory } from "./ports";

export interface TaskManagerDeps {
  windows: WindowDirectory;
  /** `app.getAppMetrics()`. */
  metrics(): ProcessMetric[];
  /** `webContents.getAllWebContents()`, for extensions' background pages. */
  allContents(): WebContents[];
}

/** `ProcessMetric` → what the pure mapping needs. */
export function toSample(metric: ProcessMetric): ProcessSample {
  return {
    pid: metric.pid,
    type: metric.type,
    name: metric.name ?? metric.serviceName,
    cpu: metric.cpu.percentCPUUsage,
    memoryKb: metric.memory.workingSetSize,
  };
}

const pidOf = (contents: WebContents): number => {
  try {
    return contents.isDestroyed() || contents.isCrashed() ? 0 : contents.getOSProcessId();
  } catch {
    return 0;
  }
};

/**
 * The task manager (`browser://tasks`, ADR-042): the app's processes with what runs in them,
 * measured on demand (the page asks every 2 s while it is shown, nothing runs otherwise).
 * "Terminer le processus" only ends a tab renderer: the tab then shows its crash page.
 */
export class TaskManagerService {
  constructor(private readonly deps: TaskManagerDeps) {}

  /** The pages of every tab, with the tab's title (masked for private windows). */
  private tabPages(): { contents: WebContents; owner: Omit<ProcessOwner, "pid"> }[] {
    return this.deps.windows.all().flatMap((window) =>
      window.spaces.allTabs().flatMap(({ manager, tab }) => {
        const contents = manager.pageOf(tab.id);
        if (!contents) return [];
        const title = window.isPrivate ? "Onglet privé" : tab.title || tab.url;
        return [{ contents, owner: { kind: "tab" as const, title, tabId: tab.id } }];
      }),
    );
  }

  owners(): ProcessOwner[] {
    const owners: ProcessOwner[] = this.tabPages().map(({ contents, owner }) => ({ ...owner, pid: pidOf(contents) }));
    for (const window of this.deps.windows.all()) owners.push({ pid: pidOf(window.window.webContents), kind: "interface", title: "Barre latérale et onglets" });
    for (const contents of this.deps.allContents()) {
      if (contents.isDestroyed() || contents.getType() !== "backgroundPage") continue;
      owners.push({ pid: pidOf(contents), kind: "extension", title: contents.getTitle() || contents.getURL() });
    }
    return owners.filter((owner) => owner.pid > 0);
  }

  list(): TaskRow[] {
    return buildTaskRows(this.deps.metrics().map(toSample), this.owners());
  }

  /** Ends a tab renderer process; false for any other process (the browser, the GPU, the interface…). */
  kill(pid: number): boolean {
    const pages = this.tabPages().filter(({ contents }) => pidOf(contents) === pid);
    if (pages.length === 0) return false;
    // One renderer may host several tabs: each of them shows the crash page.
    pages[0].contents.forcefullyCrashRenderer();
    return true;
  }
}
