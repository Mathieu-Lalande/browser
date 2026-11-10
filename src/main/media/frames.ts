import type { WebContents, WebFrameMain } from "electron";
import { FRAME_SURVEY_SCRIPT, parseFrameSurvey, type FrameVideoSurvey } from "@shared/pip-frames";

/**
 * Runs the picture-in-picture scripts in every frame of a page (ADR-056), so that a video in a
 * cross-origin iframe (an embedded player) can be reached too.
 *
 * The top frame keeps its isolated world (`worldId`: 1002 for the command, 1018 for automatic PiP).
 * Electron runs code in a subframe only through `WebFrameMain.executeJavaScript`, in that frame's
 * main world: the subframe scripts therefore only read the DOM and call the video API, and their
 * answers are validated (`parseFrameSurvey`, a fixed set of results). The worst a hostile frame can
 * do is claim to have the best video and get its own video popped out.
 */

/** Web frames of the page, top frame first (other schemes are left alone). */
export function webFrames(contents: WebContents): WebFrameMain[] {
  try {
    return contents.mainFrame.framesInSubtree.filter((frame) => !frame.isDestroyed() && !frame.detached && (frame.parent === null || /^https?:/.test(frame.url)));
  } catch {
    return [];
  }
}

/** Runs `code` in one frame (`userGesture`: the command or the tab switch is one, forwarded). */
export async function runInFrame(contents: WebContents, frame: WebFrameMain, worldId: number, code: string, userGesture = true): Promise<unknown> {
  try {
    if (frame.isDestroyed()) return "failed";
    if (frame.parent === null) return await contents.executeJavaScriptInIsolatedWorld(worldId, [{ code }], userGesture);
    return await frame.executeJavaScript(code, userGesture);
  } catch {
    return "failed";
  }
}

/** Every frame's videos, in `frames` order (null: the frame did not answer). */
export async function surveyFrames(contents: WebContents, frames: readonly WebFrameMain[], worldId: number): Promise<(FrameVideoSurvey | null)[]> {
  return Promise.all(frames.map(async (frame) => parseFrameSurvey(await runInFrame(contents, frame, worldId, FRAME_SURVEY_SCRIPT, false))));
}
