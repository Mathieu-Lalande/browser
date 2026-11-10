import { describe, expect, it } from "vitest";
import { chooseAutoPipFrame, chooseManualPipFrame, enterPipScript, exitPipScript, FRAME_SURVEY_SCRIPT, parseFrameSurvey, type FrameVideoSurvey } from "./pip-frames";

const frame = (patch: Partial<FrameVideoSurvey> = {}): FrameVideoSurvey => ({ enabled: true, pip: "none", visiblePlaying: -1, refused: false, playing: -1, paused: -1, ...patch });

describe("picture-in-picture across frames (ADR-056)", () => {
  it("validates what a frame answers", () => {
    expect(parseFrameSurvey(null)).toBeNull();
    expect(parseFrameSurvey("entered")).toBeNull();
    expect(parseFrameSurvey({ enabled: true, pip: "weird", visiblePlaying: "big", playing: Infinity, paused: 12, refused: 1 })).toEqual(frame({ paused: 12 }));
    expect(parseFrameSurvey({ enabled: true, pip: "auto", visiblePlaying: 5e12 })?.visiblePlaying).toBe(1e9);
  });

  it("automatic PiP picks the frame with the largest playing, visible video", () => {
    // A small preview playing in the page, the embedded player much larger in an iframe.
    expect(chooseAutoPipFrame([frame({ visiblePlaying: 3600 }), null, frame({ visiblePlaying: 86_400 })])).toEqual({ kind: "enter", frame: 2 });
    expect(chooseAutoPipFrame([frame(), frame({ playing: 100, paused: 900 })])).toEqual({ kind: "none" });
    // Already popped out somewhere: nothing more.
    expect(chooseAutoPipFrame([frame({ visiblePlaying: 10 }), frame({ pip: "user" })])).toEqual({ kind: "none" });
  });

  it("leaves refusing videos and frames alone", () => {
    expect(chooseAutoPipFrame([frame(), frame({ refused: true })])).toEqual({ kind: "disabled" });
    expect(chooseAutoPipFrame([frame(), frame({ enabled: false, visiblePlaying: 500 })])).toEqual({ kind: "unsupported" });
    // A frame where PiP is off never wins, even with the largest video.
    expect(chooseAutoPipFrame([frame({ visiblePlaying: 10 }), frame({ enabled: false, visiblePlaying: 500 })])).toEqual({ kind: "enter", frame: 0 });
  });

  it("the command closes an open window first, then prefers playing over paused, then size", () => {
    expect(chooseManualPipFrame([frame({ playing: 900 }), frame({ pip: "auto" })])).toEqual({ kind: "exit", frame: 1 });
    expect(chooseManualPipFrame([frame({ paused: 90_000 }), frame({ playing: 0 })])).toEqual({ kind: "enter", frame: 1 });
    expect(chooseManualPipFrame([frame({ paused: 100 }), frame({ paused: 4000 })])).toEqual({ kind: "enter", frame: 1 });
    expect(chooseManualPipFrame([frame(), frame()])).toEqual({ kind: "none" });
    expect(chooseManualPipFrame([frame({ enabled: false, playing: 10 })])).toEqual({ kind: "unsupported" });
  });

  it("builds plain scripts (no interpolation of page data)", () => {
    for (const code of [FRAME_SURVEY_SCRIPT, enterPipScript(true), enterPipScript(false), exitPipScript(true), exitPipScript(false)]) {
      expect(() => new Function(`return ${code}`)).not.toThrow();
    }
    expect(enterPipScript(true)).toContain("const auto = true");
    expect(exitPipScript(false)).toContain("if (false)");
  });
});
