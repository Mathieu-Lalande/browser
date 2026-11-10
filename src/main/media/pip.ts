import type { WebContents } from "electron";
import { chooseManualPipFrame, enterPipScript, exitPipScript } from "@shared/pip-frames";
import { runInFrame, surveyFrames, webFrames } from "./frames";

/** Isolated world of the picture-in-picture script (the cosmetic filter's scan uses 1001). */
const PIP_WORLD_ID = 1002;

export type PictureInPictureResult = "entered" | "exited" | "none" | "unsupported" | "failed";

const RESULTS: ReadonlySet<string> = new Set(["entered", "exited", "none", "unsupported", "failed"]);

/**
 * Toggles picture-in-picture on the page's main video, whatever frame it is in (ADR-035, 056): a
 * window already open in any frame is closed; otherwise the best video — playing first, then the
 * largest visible one — is popped out. The top frame's script runs in an isolated world (no preload,
 * ADR-003), subframes' as `frames.ts` explains. `requestPictureInPicture` needs a user gesture: the
 * command comes from one (shortcut, menu or palette), forwarded to the frame.
 */
export async function togglePictureInPicture(contents: WebContents): Promise<PictureInPictureResult> {
  const frames = webFrames(contents);
  const decision = chooseManualPipFrame(await surveyFrames(contents, frames, PIP_WORLD_ID));
  if (decision.kind !== "enter" && decision.kind !== "exit") return decision.kind === "unsupported" ? "unsupported" : "none";
  const code = decision.kind === "enter" ? enterPipScript(false) : exitPipScript(false);
  const result = String(await runInFrame(contents, frames[decision.frame], PIP_WORLD_ID, code));
  return RESULTS.has(result) ? (result as PictureInPictureResult) : "failed";
}
