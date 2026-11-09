/**
 * Task manager (`browser://tasks`, ADR-042): one row per OS process of the app, labelled with what
 * runs in it (tabs, extensions, the browser's own interface…). Pure mapping and sorting; main reads
 * `app.getAppMetrics()` and `webContents.getOSProcessId()` and does the killing.
 */

import { t as tr, t, intlLocale } from "./i18n";

export type TaskKind = "browser" | "gpu" | "interface" | "tab" | "extension" | "utility" | "other";

/** What main knows of one process (`ProcessMetric`, reduced). */
export interface ProcessSample {
  pid: number;
  /** Electron's type: Browser, Tab, GPU, Utility, Zygote, Pepper Plugin… */
  type: string;
  /** Utility processes' service name ("Network Service", "Audio Service"…). */
  name?: string;
  /** CPU % since the previous sample. */
  cpu: number;
  /** Working set, in kilobytes. */
  memoryKb: number;
}

/** A webContents living in some process. */
export interface ProcessOwner {
  pid: number;
  kind: "tab" | "extension" | "interface";
  title: string;
  /** Tabs only: their id, and whether they belong to a private window. */
  tabId?: string;
}

export interface TaskRow {
  pid: number;
  kind: TaskKind;
  title: string;
  /** Other things sharing the process (a renderer can host several tabs). */
  detail: string;
  cpu: number;
  memoryKb: number;
  /** Only tab renderers may be ended (they then show the crash page). */
  killable: boolean;
}

export type TaskSortKey = "title" | "cpu" | "memory" | "pid";
export const TASK_SORT_KEYS: readonly TaskSortKey[] = ["title", "cpu", "memory", "pid"];
/** How often the open page refreshes. */
export const TASKS_REFRESH_MS = 2000;

const KIND_TITLES: Record<TaskKind, string> = {
  get browser() { return tr("tasks.browser") },
  get gpu() { return tr("tasks.gpuProcess") },
  get interface() { return t("tasks.browserInterface") },
  get tab() { return t("tasks.tab") },
  extension: "Extension",
  utility: "Service",
  get other() { return tr("tasks.process") },
};

const PREFIX: Record<ProcessOwner["kind"], string> = { get tab() { return t("tasks.tab") }, extension: "Extension", interface: "Interface" };

function baseKind(sample: ProcessSample): TaskKind {
  if (sample.type === "Browser") return "browser";
  if (sample.type === "GPU") return "gpu";
  if (sample.type === "Utility") return "utility";
  return "other";
}

/** The rows of the task manager: each process with its owners (tabs first) and its usage. */
export function buildTaskRows(samples: readonly ProcessSample[], owners: readonly ProcessOwner[]): TaskRow[] {
  return samples.map((sample) => {
    const mine = owners.filter((owner) => owner.pid === sample.pid);
    const order = { tab: 0, extension: 1, interface: 2 } as const;
    mine.sort((a, b) => order[a.kind] - order[b.kind]);
    const first = mine[0];
    const kind: TaskKind = first ? first.kind : baseKind(sample);
    const title = first
      ? `${PREFIX[first.kind]} : ${first.title || tr("tasks.untitled")}`
      : sample.type === "Utility" && sample.name
        ? `${KIND_TITLES.utility} : ${sample.name}`
        : KIND_TITLES[kind];
    const others = mine.length - 1;
    return {
      pid: sample.pid,
      kind,
      title,
      detail: others > 0 ? t("tasks.others", { others }) : "",
      cpu: Math.max(0, Math.round(sample.cpu * 10) / 10),
      memoryKb: Math.max(0, Math.round(sample.memoryKb)),
      killable: mine.some((owner) => owner.kind === "tab"),
    };
  });
}

/** Rows sorted by `key` (descending numbers by default, ascending titles); ties by pid. */
export function sortTaskRows(rows: readonly TaskRow[], key: TaskSortKey, descending = key === "cpu" || key === "memory"): TaskRow[] {
  const value = (row: TaskRow) => (key === "cpu" ? row.cpu : key === "memory" ? row.memoryKb : key === "pid" ? row.pid : 0);
  const compare = (a: TaskRow, b: TaskRow) => {
    const diff = key === "title" ? a.title.localeCompare(b.title, intlLocale()) : value(a) - value(b);
    return diff !== 0 ? diff : a.pid - b.pid;
  };
  return [...rows].sort((a, b) => (descending ? compare(b, a) : compare(a, b)));
}

/** "12,3 Mo" from kilobytes. */
export function formatMemory(kb: number): string {
  const mb = kb / 1024;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1).replace(".", ",")} Mo`;
}
