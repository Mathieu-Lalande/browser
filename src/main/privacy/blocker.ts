import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { FiltersEngine, Request, adsAndTrackingLists, type RequestType } from "@ghostery/adblocker";
import workerPath from "./blocker-worker?modulePath";
import { ENGINE_CONFIG } from "./blocker-config";
import { writeFileAtomic } from "./json-file";

const REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
const RETRY_DELAY = 30 * 60 * 1000;
/** uBlock Origin resources (redirect targets such as noop.js), next to the lists on the same host. */
const RESOURCES_URL = new URL("../ublock-origin/resources.json", adsAndTrackingLists[0]).href;

/** Class names, ids and link targets found in a page, for generic element-hiding rules. */
export interface DomFeatures {
  classes: string[];
  ids: string[];
  hrefs: string[];
}

export type FetchText = (url: string) => Promise<string>;

export interface BlockVerdict {
  /** A neutered replacement (data: URL) to serve instead of cancelling, e.g. an empty script. */
  redirectUrl?: string;
}

/**
 * Ghostery's filter engine (EasyList, EasyPrivacy, uBlock Origin lists) with its lifecycle:
 * serialized cache in userData, background rebuild every ~24h, and no blocking at all (rather
 * than a crash) while no engine is available, e.g. on a first start while offline.
 */
export class ContentBlocker {
  private engine: FiltersEngine | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly cacheFile: string,
    private readonly fetchText: FetchText,
    /** Test hook: a local filter list replacing the downloaded ones (never set in a packaged app). */
    private readonly testFilters?: string,
  ) {}

  /** Never blocks the caller: the cache is read and the lists refreshed asynchronously. */
  start(): void {
    // Test hook: a local filter list replaces the downloaded ones (e2e tests stay offline).
    if (this.testFilters) {
      this.engine = FiltersEngine.parse(readFileSync(this.testFilters, "utf8"), ENGINE_CONFIG);
      return;
    }
    void this.loadCache().then((updatedAt) => this.schedule(updatedAt + REFRESH_INTERVAL - Date.now()));
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  /** Verdict for a subresource of a page, or null to let it through. */
  match(url: string, type: string, pageUrl: string): BlockVerdict | null {
    if (!this.engine) return null;
    const request = Request.fromRawDetails({ url, sourceUrl: pageUrl, type: type as RequestType });
    if (request.type === "other") request.guessTypeOfRequest();
    const { match, redirect } = this.engine.match(request);
    if (redirect) return { redirectUrl: redirect.dataUrl };
    return match ? {} : null;
  }

  /**
   * Element-hiding CSS for a page, "" if none. Without `dom`: site-specific and generic complex rules
   * (known as soon as the page commits). With `dom`: the generic rules matching the classes, ids and
   * links found in the page (the bulk of EasyList's generic hiding).
   */
  cosmeticStyles(pageUrl: string, dom?: DomFeatures): string {
    if (!this.engine) return "";
    const { hostname, domain } = Request.fromRawDetails({ url: pageUrl });
    const { active, styles } = this.engine.getCosmeticsFilters({
      url: pageUrl,
      hostname,
      domain: domain || "",
      ...dom,
      getBaseRules: !dom,
      getRulesFromHostname: !dom,
      getRulesFromDOM: !!dom,
      getInjectionRules: false,
      getExtendedRules: false,
    });
    return active ? styles : "";
  }

  /** Loads the serialized engine; returns its age reference (0 when there is no usable cache). */
  private async loadCache(): Promise<number> {
    try {
      const [info, bytes] = await Promise.all([stat(this.cacheFile), readFile(this.cacheFile)]);
      this.engine = FiltersEngine.deserialize(bytes);
      return info.mtimeMs;
    } catch {
      // Missing, or written by another engine version: rebuild.
      return 0;
    }
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), Math.max(0, delay));
    this.timer.unref();
  }

  private async refresh(): Promise<void> {
    try {
      const lists = await Promise.all(adsAndTrackingLists.map(this.fetchText));
      const resources = await this.fetchText(RESOURCES_URL).catch(() => null);
      const bytes = await buildInWorker(lists, resources);
      this.engine = FiltersEngine.deserialize(bytes);
      await writeFileAtomic(this.cacheFile, bytes);
      this.schedule(REFRESH_INTERVAL);
    } catch (error) {
      console.warn("[privacy] filter lists update failed, retrying later:", error);
      this.schedule(RETRY_DELAY);
    }
  }
}

function buildInWorker(lists: string[], resources: string | null): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { lists, resources } });
    worker.once("message", (bytes: Uint8Array) => {
      resolve(bytes);
      void worker.terminate();
    });
    worker.once("error", reject);
    worker.once("exit", (code) => reject(new Error(`filter worker exited with code ${code}`)));
  });
}
