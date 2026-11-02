import { isBoostId, isValidSelector } from "@shared/boosts";
import { Channels } from "@shared/ipc";
import { boostForTab, createBoostForTab, listBoosts, removeBoost, saveBoost, startZap, unzap } from "../boosts";
import { copyCapture, discardCapture, saveCapture, showPageOptions } from "../capture";
import { finishRecording, isRecordingData, recordingFailed, recordingStarted } from "../capture/record";
import { MAX_BOOST_PAYLOAD } from "./limits";
import { bounds, custom, defineHandlers, handle, handleUi, on, str } from "./registry";

/** Any object (its fields are validated by the shared boost model) under the size limit. */
const smallObject = custom<object>((value) => typeof value === "object" && value !== null && JSON.stringify(value).length <= MAX_BOOST_PAYLOAD);

/**
 * Boosts (ADR-029): whole boosts validated by the shared model (sizes, pattern, selectors);
 * tabs named by id, their URL read here. Private windows read only (checked in ../boosts).
 */
export const boostHandlers = defineHandlers({
  [Channels.boostsList]: handleUi([], () => listBoosts()),
  [Channels.boostsForTab]: handle([str], (c, tabId) => boostForTab(c, tabId)),
  [Channels.boostsCreateForTab]: handle([str], (c, tabId) => createBoostForTab(c, tabId)),
  [Channels.boostsSave]: handle([smallObject], (c, boost) => saveBoost(c, boost)),
  [Channels.boostsRemove]: handle([isBoostId], (c, boostId) => removeBoost(c, boostId)),
  [Channels.boostsUnzap]: handle([str, isValidSelector], (c, tabId, selector) => unzap(c, tabId, selector)),
  [Channels.boostsZap]: on([str], (c, tabId) => startZap(c, tabId)),
});

/** Page options and captures (ADR-031): images named by id (kept per window), recordings as bytes. */
export const captureHandlers = defineHandlers({
  [Channels.pageOptionsShow]: on([bounds], (c, anchor) => showPageOptions(c, anchor)),
  [Channels.captureCopy]: handle([str], (c, captureId) => copyCapture(c, captureId)),
  [Channels.captureSave]: handle([str], (c, captureId) => saveCapture(c, captureId)),
  [Channels.captureDiscard]: on([str], (c, captureId) => discardCapture(c, captureId)),
  [Channels.recordingStarted]: on([], (c) => recordingStarted(c)),
  [Channels.recordingFailed]: on([], (c) => recordingFailed(c)),
  [Channels.recordingFinish]: handle([isRecordingData], (c, data) => finishRecording(c, data)),
});
