import { api } from "./browser.svelte";

/**
 * The tab recorder (ADR-031), in the chrome UI: main asks to start, `getDisplayMedia` gets the one
 * source main grants (the recorded tab's frame), MediaRecorder encodes WebM, and the file goes
 * back to main, which owns the state and the save dialog. Nothing is kept here afterwards.
 */

let recorder: MediaRecorder | null = null;

const MIME_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

async function stream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (error) {
    console.warn("Recording audio:", error);
    // No audio for this tab (or refused): the picture alone.
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  }
}

async function start(): Promise<void> {
  if (recorder) return;
  let media: MediaStream;
  try {
    media = await stream();
  } catch (error) {
    console.warn("Recording:", error);
    api.recording.failed();
    return;
  }
  const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  const current = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  current.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  current.onstop = () => {
    for (const track of media.getTracks()) track.stop();
    recorder = null;
    void new Blob(chunks, { type: "video/webm" })
      .arrayBuffer()
      .then((buffer) => api.recording.finish(new Uint8Array(buffer)))
      .catch(() => {});
  };
  // The tab went away (closed, crashed): what was recorded is still offered.
  media.getVideoTracks()[0]?.addEventListener("ended", stop);
  recorder = current;
  current.start(1000);
  api.recording.started();
}

function stop(): void {
  if (recorder?.state === "recording") recorder.stop();
}

/** Listens for main's requests; returns the unsubscribe function. */
export function installRecorder(): () => void {
  return api.recording.onControl((action) => (action === "start" ? void start() : stop()));
}
