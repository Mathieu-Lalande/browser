import type { WebContents } from "electron";

/** Isolated world of the picture-in-picture script (the cosmetic filter's scan uses 1001). */
const PIP_WORLD_ID = 1002;

/**
 * Picks the page's main video and toggles picture-in-picture on it. It runs in an isolated world
 * (shared DOM, separate JavaScript globals: the page cannot tamper with it, and nothing stays in
 * the page): no preload is involved (ADR-003). The best candidate is a playing video, then the
 * largest visible one.
 */
const PIP_SCRIPT = `(() => {
  if (!document.pictureInPictureEnabled) return "unsupported";
  if (document.pictureInPictureElement) return document.exitPictureInPicture().then(() => "exited", () => "failed");
  const visibleArea = (video) => {
    const rect = video.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return width * height;
  };
  const candidates = [...document.querySelectorAll("video")]
    .filter((video) => video.readyState > 0 && !video.disablePictureInPicture)
    .map((video) => ({ video, playing: !video.paused && !video.ended, area: visibleArea(video) }))
    .sort((a, b) => Number(b.playing) - Number(a.playing) || b.area - a.area);
  const best = candidates[0];
  if (!best) return "none";
  return best.video.requestPictureInPicture().then(() => "entered", () => "failed");
})()`;

export type PictureInPictureResult = "entered" | "exited" | "none" | "unsupported" | "failed";

/**
 * `requestPictureInPicture` needs a user gesture: the command comes from one (shortcut, menu or
 * palette), which `userGesture` forwards to the page.
 */
export async function togglePictureInPicture(contents: WebContents): Promise<PictureInPictureResult> {
  try {
    return await contents.executeJavaScriptInIsolatedWorld(PIP_WORLD_ID, [{ code: PIP_SCRIPT }], true);
  } catch {
    return "failed";
  }
}
