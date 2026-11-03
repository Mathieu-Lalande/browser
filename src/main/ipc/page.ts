import { isBoostId, isValidSelector } from "@shared/boosts";
import { Channels } from "@shared/ipc";
import { isRecordingData } from "../capture/recorder";
import { appServices } from "../app-services-ref";
import { MAX_BOOST_PAYLOAD } from "./limits";
import { bounds, custom, defineHandlers, handle, handleUi, on, str } from "./registry";

/** Any object (its fields are validated by the shared boost model) under the size limit. */
const boosts = () => appServices().boosts;
const captures = () => appServices().capture;

const smallObject = custom<object>((value) => typeof value === "object" && value !== null && JSON.stringify(value).length <= MAX_BOOST_PAYLOAD);

/**
 * Boosts (ADR-029): whole boosts validated by the shared model (sizes, pattern, selectors);
 * tabs named by id, their URL read here. Private windows read only (checked in ../boosts).
 */
export const boostHandlers = defineHandlers({
  [Channels.boostsList]: handleUi([], () => boosts().list()),
  [Channels.boostsForTab]: handle([str], (c, tabId) => boosts().forTab(c, tabId)),
  [Channels.boostsCreateForTab]: handle([str], (c, tabId) => boosts().createForTab(c, tabId)),
  [Channels.boostsSave]: handle([smallObject], (c, boost) => boosts().save(c, boost)),
  [Channels.boostsRemove]: handle([isBoostId], (c, boostId) => boosts().remove(c, boostId)),
  [Channels.boostsUnzap]: handle([str, isValidSelector], (c, tabId, selector) => boosts().unzap(c, tabId, selector)),
  [Channels.boostsZap]: on([str], (c, tabId) => boosts().startZap(c, tabId)),
});

/** Page options and captures (ADR-031): images named by id (kept per window), recordings as bytes. */
export const captureHandlers = defineHandlers({
  [Channels.pageOptionsShow]: on([bounds], (c, anchor) => captures().showPageOptions(c, anchor)),
  [Channels.captureCopy]: handle([str], (c, captureId) => captures().copy(c, captureId)),
  [Channels.captureSave]: handle([str], (c, captureId) => captures().save(c, captureId)),
  [Channels.captureDiscard]: on([str], (c, captureId) => captures().discard(c, captureId)),
  [Channels.recordingStarted]: on([], (c) => captures().recorder.started(c)),
  [Channels.recordingFailed]: on([], (c) => captures().recorder.failed(c)),
  [Channels.recordingFinish]: handle([isRecordingData], (c, data) => captures().recorder.finish(c, data)),
});
