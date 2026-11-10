/**
 * Picture-in-picture across a page's frames (ADR-056): embedded players (YouTube, Vimeo…) live in
 * cross-origin iframes the top document cannot see into. Main asks every frame what it plays
 * (`FRAME_SURVEY_SCRIPT`), this pure module picks the frame, then main runs the enter or exit script
 * in that frame only. Same rules as before: playing first, then the largest visible video; a video
 * or a frame that refuses picture-in-picture is left alone.
 */

export interface FrameVideoSurvey {
  /** `document.pictureInPictureEnabled` (false when the permissions policy turns it off). */
  enabled: boolean;
  /** A video of this document is in picture-in-picture: put there by automatic PiP, or by the user. */
  pip: "none" | "auto" | "user";
  /** Largest visible area of a playing video that accepts PiP (-1: none) — automatic PiP. */
  visiblePlaying: number;
  /** A playing, visible video says `disablePictureInPicture`. */
  refused: boolean;
  /** Largest visible area of a playing video that accepts PiP, on screen or not (-1: none) — command. */
  playing: number;
  /** Largest visible area of a ready, paused video that accepts PiP (-1: none) — command. */
  paused: number;
}

/** Runs in each frame; reads the DOM only and answers plain numbers (`parseFrameSurvey` checks them). */
export const FRAME_SURVEY_SCRIPT = `(() => {
  const visibleArea = (video) => {
    const rect = video.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return width * height;
  };
  let visiblePlaying = -1, playing = -1, paused = -1, refused = false;
  for (const video of document.querySelectorAll("video")) {
    const area = visibleArea(video);
    const isPlaying = !video.paused && !video.ended;
    if (isPlaying && video.readyState > 1 && area > 0) {
      if (video.disablePictureInPicture) refused = true;
      else visiblePlaying = Math.max(visiblePlaying, area);
    }
    if (video.disablePictureInPicture || video.readyState < 1) continue;
    if (isPlaying) playing = Math.max(playing, area);
    else paused = Math.max(paused, area);
  }
  const element = document.pictureInPictureElement;
  const pip = !element ? "none" : element.dataset && element.dataset.browserAutoPip === "1" ? "auto" : "user";
  return { enabled: document.pictureInPictureEnabled === true, pip, visiblePlaying, refused, playing, paused };
})()`;

const area = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, 1e9) : -1);

/** Validates a frame's answer (a page could answer anything); null when unusable. */
export function parseFrameSurvey(value: unknown): FrameVideoSurvey | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const pip = v.pip === "auto" || v.pip === "user" ? v.pip : "none";
  return { enabled: v.enabled === true, pip, visiblePlaying: area(v.visiblePlaying), refused: v.refused === true, playing: area(v.playing), paused: area(v.paused) };
}

export type FramePipDecision =
  | { kind: "enter"; frame: number }
  | { kind: "exit"; frame: number }
  | { kind: "none" | "disabled" | "unsupported" };

/** Index of the best frame by `score` (-1 values left out); null when none qualifies. */
function best(surveys: readonly (FrameVideoSurvey | null)[], score: (survey: FrameVideoSurvey) => number): number | null {
  let found: number | null = null;
  let top = -1;
  surveys.forEach((survey, index) => {
    if (!survey?.enabled) return;
    const value = score(survey);
    if (value > top) {
      top = value;
      found = index;
    }
  });
  return found;
}

/**
 * Automatic PiP (leaving the tab): the frame with the largest playing, visible video. Nothing
 * while one is already popped out; "disabled"/"unsupported" when the only playing videos refuse.
 */
export function chooseAutoPipFrame(surveys: readonly (FrameVideoSurvey | null)[]): FramePipDecision {
  if (surveys.some((survey) => survey && survey.pip !== "none")) return { kind: "none" };
  const frame = best(surveys, (survey) => survey.visiblePlaying);
  if (frame !== null) return { kind: "enter", frame };
  if (surveys.some((survey) => survey?.refused)) return { kind: "disabled" };
  if (surveys.some((survey) => survey && !survey.enabled && survey.visiblePlaying >= 0)) return { kind: "unsupported" };
  return { kind: "none" };
}

/**
 * The picture-in-picture command: closes the window if a frame has one, otherwise pops out the
 * best video of the page — playing first, then the largest — whatever frame it is in.
 */
export function chooseManualPipFrame(surveys: readonly (FrameVideoSurvey | null)[]): FramePipDecision {
  const open = surveys.findIndex((survey) => survey && survey.pip !== "none");
  if (open >= 0) return { kind: "exit", frame: open };
  const frame = best(surveys, (survey) => survey.playing) ?? best(surveys, (survey) => survey.paused);
  if (frame !== null) return { kind: "enter", frame };
  return surveys.some((survey) => survey?.enabled) || surveys.length === 0 ? { kind: "none" } : { kind: "unsupported" };
}

/**
 * Enters PiP in the chosen frame with the same choice of video as the survey. `auto`: playing and
 * visible only, and marked so that automatic PiP closes only the windows it opened.
 */
export function enterPipScript(auto: boolean): string {
  return `(() => {
  if (!document.pictureInPictureEnabled) return "unsupported";
  const auto = ${auto ? "true" : "false"};
  const visibleArea = (video) => {
    const rect = video.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return width * height;
  };
  const candidates = [...document.querySelectorAll("video")]
    .filter((video) => !video.disablePictureInPicture && video.readyState > (auto ? 1 : 0))
    .map((video) => ({ video, playing: !video.paused && !video.ended, area: visibleArea(video) }))
    .filter((candidate) => !auto || (candidate.playing && candidate.area > 0))
    .sort((a, b) => Number(b.playing) - Number(a.playing) || b.area - a.area);
  if (!candidates.length) return "none";
  if (auto) candidates[0].video.dataset.browserAutoPip = "1";
  return candidates[0].video.requestPictureInPicture().then(() => "entered", () => "failed");
})()`;
}

/** Leaves PiP in a frame: any video (the command), or only one automatic PiP popped out. */
export function exitPipScript(auto: boolean): string {
  return `(() => {
  const element = document.pictureInPictureElement;
  if (!element) return "none";
  if (${auto ? "true" : "false"}) {
    if (element.dataset.browserAutoPip !== "1") return "none";
    delete element.dataset.browserAutoPip;
  }
  return document.exitPictureInPicture().then(() => "exited", () => "failed");
})()`;
}
