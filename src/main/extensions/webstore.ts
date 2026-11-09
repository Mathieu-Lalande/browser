import { t } from "@shared/i18n";
import { session } from "electron";
import { ASSETS_PARTITION } from "../start-image";
import { crxDownloadUrl, parseUpdateCheck, updateCheckUrl, WEBSTORE_UPDATE_URL } from "@shared/webstore";
import { verifyCrx, type VerifiedCrx } from "./crx";
import { UnpackError } from "./unpack";

/** What the client fetches with (main passes the in-memory assets session: no cookies, nothing on disk). */
export type WebStoreFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export interface WebStoreOptions {
  fetch: WebStoreFetch;
  /** Chrome's major version, sent as `prodversion` (the store answers with packages it supports). */
  chromeMajor: number;
  /** A local fake store (dev-only test hook `BROWSER_TEST_WEBSTORE_URL`): its origin. */
  testOrigin?: string | null;
}

const MAX_CRX_SIZE = 100 * 1024 * 1024;
const MAX_XML_SIZE = 256 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const CHECK_TIMEOUT_MS = 20_000;

/** Ids per version check request (the URL stays well under any limit). */
const CHECK_BATCH = 25;

/**
 * Chrome Web Store client (ADR-049): downloads verified CRX3 packages and asks for the latest
 * versions, both through Google's update service (or the test origin's `/service/update2/crx`).
 */
export class WebStoreClient {
  private readonly endpoint: string;

  constructor(private readonly options: WebStoreOptions) {
    this.endpoint = options.testOrigin ? `${options.testOrigin}/service/update2/crx` : WEBSTORE_UPDATE_URL;
  }

  /** The store origin the UI recognizes besides Google's (test hook), or null. */
  get testOrigin(): string | null {
    return this.options.testOrigin ?? null;
  }

  /** The latest package of `id`, signature and id checked. Throws `UnpackError` (French message). */
  async download(id: string, onVerify?: () => void): Promise<VerifiedCrx> {
    let response: Response;
    try {
      response = await this.options.fetch(crxDownloadUrl(id, this.options.chromeMajor, this.endpoint), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch {
      throw new UnpackError(t("extensionsWebstore.cantReachChromeWeb"));
    }
    if (response.status === 204 || response.status === 404) throw new UnpackError(t("extensionsWebstore.extensionIsntAvailableDownload"));
    if (!response.ok) throw new UnpackError(t("extensionsWebstore.chromeWebStoreRefused", { status: response.status }));
    if (Number(response.headers.get("content-length") ?? 0) > MAX_CRX_SIZE) throw new UnpackError(t("extensionsWebstore.extensionTooLarge"));
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > MAX_CRX_SIZE) throw new UnpackError(t("extensionsWebstore.extensionTooLarge"));
    onVerify?.();
    return verifyCrx(data, id);
  }

  /** Latest store versions of the given extensions (ids missing from the map: unknown or no answer). */
  async latestVersions(entries: readonly { id: string; version: string }[]): Promise<Map<string, string>> {
    const versions = new Map<string, string>();
    for (let start = 0; start < entries.length; start += CHECK_BATCH) {
      const url = updateCheckUrl(entries.slice(start, start + CHECK_BATCH), this.options.chromeMajor, this.endpoint);
      const response = await this.options.fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
      if (!response.ok) throw new UnpackError(t("extensionsWebstore.chromeWebStoreDidnt", { status: response.status }));
      const xml = await response.text();
      if (xml.length > MAX_XML_SIZE) throw new UnpackError(t("extensionsWebstore.chromeWebStoreResponse"));
      for (const [id, version] of parseUpdateCheck(xml)) versions.set(id, version);
    }
    return versions;
  }
}

/**
 * The app's client: requests go through the in-memory assets session (no cookies, nothing on disk),
 * `prodversion` is this Chromium's major version.
 */
export function createWebStoreClient(testOrigin: string | null): WebStoreClient {
  return new WebStoreClient({
    fetch: (url, init) => session.fromPartition(ASSETS_PARTITION).fetch(url, { ...init, credentials: "omit" }),
    chromeMajor: Number(process.versions.chrome?.split(".")[0]) || 140,
    testOrigin,
  });
}
