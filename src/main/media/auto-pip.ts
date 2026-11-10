import type { WebContents } from "electron";
import { AutoPipPolicy, type AutoPipAction, type AutoPipOutcome } from "@shared/auto-pip";
import { chooseAutoPipFrame, enterPipScript, exitPipScript } from "@shared/pip-frames";
import type { TabId } from "@shared/types";
import { runInFrame, surveyFrames, webFrames } from "./frames";

/** Isolated world of the automatic picture-in-picture scripts (ADR-047; the manual command uses 1002). */
const AUTO_PIP_WORLD_ID = 1018;

const OUTCOMES: ReadonlySet<string> = new Set(["entered", "none", "disabled", "unsupported", "failed"]);

/**
 * Pops out the page's largest playing, visible video, whatever frame it is in (ADR-056). Sites keep
 * the last word: a frame whose permissions policy turns picture-in-picture off ("unsupported") or
 * whose videos say `disablePictureInPicture` ("disabled") is left alone. Muted autoplaying
 * backgrounds count only while they are on screen. The tab switch is the user gesture, forwarded.
 */
async function enter(contents: WebContents): Promise<AutoPipOutcome> {
  const frames = webFrames(contents);
  const decision = chooseAutoPipFrame(await surveyFrames(contents, frames, AUTO_PIP_WORLD_ID));
  if (decision.kind !== "enter") return decision.kind === "exit" ? "none" : decision.kind;
  const result = String(await runInFrame(contents, frames[decision.frame], AUTO_PIP_WORLD_ID, enterPipScript(true)));
  return OUTCOMES.has(result) ? (result as AutoPipOutcome) : "failed";
}

/** Puts back only a video this feature popped out (one the user popped out stays), in any frame. */
async function exit(contents: WebContents): Promise<string> {
  const results = await Promise.all(webFrames(contents).map((frame) => runInFrame(contents, frame, AUTO_PIP_WORLD_ID, exitPipScript(true))));
  return results.includes("exited") ? "exited" : results.includes("failed") ? "failed" : "none";
}

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
    const result = action.kind === "enter" ? await enter(contents) : await exit(contents);
    this.host.log?.({ kind: action.kind, url, result });
    if (action.kind !== "enter") return;
    this.policy.entered(action.tabId, result as AutoPipOutcome);
    // Back on that tab before the page answered: its video goes straight back.
    if (result === "entered" && this.policy.isOnScreen(action.tabId) && !contents.isDestroyed()) await exit(contents);
  }
}
