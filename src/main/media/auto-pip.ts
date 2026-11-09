import type { WebContents } from "electron";
import { AutoPipPolicy, type AutoPipAction, type AutoPipOutcome } from "@shared/auto-pip";
import type { TabId } from "@shared/types";

/** Isolated world of the automatic picture-in-picture scripts (ADR-047; the manual command uses 1002). */
const AUTO_PIP_WORLD_ID = 1018;

/**
 * Pops out the page's playing, visible video. Sites keep the last word: a page whose permissions
 * policy turns picture-in-picture off ("unsupported") or whose videos say `disablePictureInPicture`
 * ("disabled") is left alone. Muted autoplaying backgrounds count only while they are on screen.
 */
const ENTER_SCRIPT = `(() => {
  if (!document.pictureInPictureEnabled) return "unsupported";
  if (document.pictureInPictureElement) return "none";
  const visibleArea = (video) => {
    const rect = video.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return width * height;
  };
  const playing = [...document.querySelectorAll("video")].filter((video) => !video.paused && !video.ended && video.readyState > 1 && visibleArea(video) > 0);
  if (!playing.length) return "none";
  const allowed = playing.filter((video) => !video.disablePictureInPicture).sort((a, b) => visibleArea(b) - visibleArea(a));
  if (!allowed.length) return "disabled";
  allowed[0].dataset.browserAutoPip = "1";
  return allowed[0].requestPictureInPicture().then(() => "entered", () => "failed");
})()`;

/** Puts back only a video this feature popped out (one the user popped out stays). */
const EXIT_SCRIPT = `(() => {
  const element = document.pictureInPictureElement;
  if (!element || element.dataset.browserAutoPip !== "1") return "none";
  delete element.dataset.browserAutoPip;
  return document.exitPictureInPicture().then(() => "exited", () => "failed");
})()`;

/** A request and its answer (test hook `BROWSER_TEST_AUTO_PIP`). */
export interface AutoPipLogEntry {
  kind: AutoPipAction["kind"];
  url: string;
  result: string;
}

export interface AutoPipHost {
  enabled(): boolean;
  /** The live page of a tab of the window (null: asleep, closed, internal page). */
  pageOf(tabId: TabId): WebContents | null;
  log?: (entry: AutoPipLogEntry) => void;
}

async function run(contents: WebContents, code: string): Promise<string> {
  try {
    // `requestPictureInPicture` wants a user gesture: the tab switch is one, forwarded here.
    return String(await contents.executeJavaScriptInIsolatedWorld(AUTO_PIP_WORLD_ID, [{ code }], true));
  } catch {
    return "failed";
  }
}

/**
 * Automatic picture-in-picture of one window (ADR-047, off by default): told which tab is shown
 * (`sync`), it asks the pure policy what to do and runs it in the pages.
 */
export class AutoPip {
  private readonly policy = new AutoPipPolicy();

  constructor(private readonly host: AutoPipHost) {}

  /** The window shows `tabId` now (called with every state change; same tab: nothing). */
  sync(tabId: TabId | null): void {
    const actions = this.policy.activate(tabId, {
      enabled: this.host.enabled(),
      canEnter: (id) => {
        const page = this.host.pageOf(id);
        return !!page && !page.isDestroyed() && /^https?:/.test(page.getURL());
      },
    });
    for (const action of actions) void this.apply(action);
  }

  private async apply(action: AutoPipAction): Promise<void> {
    const contents = this.host.pageOf(action.tabId);
    if (!contents || contents.isDestroyed()) return this.policy.forget(action.tabId);
    const url = contents.getURL();
    const result = await run(contents, action.kind === "enter" ? ENTER_SCRIPT : EXIT_SCRIPT);
    this.host.log?.({ kind: action.kind, url, result });
    if (action.kind !== "enter") return;
    this.policy.entered(action.tabId, result as AutoPipOutcome);
    // Back on that tab before the page answered: its video goes straight back.
    if (result === "entered" && this.policy.isOnScreen(action.tabId) && !contents.isDestroyed()) await run(contents, EXIT_SCRIPT);
  }
}
