import { Channels } from "@shared/ipc";
import { isMediaAction, type MediaAction } from "@shared/media";
import { custom, defineHandlers, handle, on, str } from "./registry";

const mediaAction = custom<MediaAction>(isMediaAction);

/** The media hub of the sender's window (ADR-035): tabs are named by id, unknown ids are ignored. */
export const mediaHandlers = defineHandlers({
  [Channels.mediaList]: handle([], (c) => c.media.sources(), { fallback: [] }),
  [Channels.mediaAction]: on([str, mediaAction], (c, tabId, action) => void c.media.act(tabId, action)),
  [Channels.mediaPictureInPicture]: on([str], (c, tabId) => c.media.pictureInPicture(tabId)),
  [Channels.mediaFocus]: on([str], (c, tabId) => c.media.focus(tabId)),
  [Channels.mediaMute]: on([str], (c, tabId) => c.media.toggleMute(tabId)),
  [Channels.mediaDismiss]: on([str], (c, tabId) => void c.media.dismiss(tabId)),
});
