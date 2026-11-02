import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dialog, webContents as allContents, type WebContents } from "electron";
import { Channels } from "@shared/ipc";
import { MAX_RECORDING_BYTES, captureFileName, type RecordingState } from "@shared/capture";
import { downloadsFolder } from "../downloads";
import { setDisplayCaptureGate, uiSession } from "../ui-session";
import { BrowserController } from "../window";

/**
 * Tab recording (ADR-031). The chrome UI runs a MediaRecorder on `getDisplayMedia()`; the UI
 * session's display-media handler grants it exactly one source, the recorded tab's own frame
 * (Chromium tab capture: the page only, at its size, with its audio), and only right after main
 * asked for it. No picker, no screen or other window can be captured, and pages never get the
 * handler (their sessions refuse display capture, ADR-008). Main owns the state and saves the WebM.
 */

interface Recording extends RecordingState {
  url: string;
  contents: WebContents;
}

/** Started from main, waiting for the UI's `getDisplayMedia` call. */
const requests = new WeakMap<BrowserController, { tabId: string; url: string; contents: WebContents }>();
const recordings = new WeakMap<BrowserController, Recording>();

export function recordingOf(c: BrowserController): RecordingState | null {
  const recording = recordings.get(c);
  return recording ? { tabId: recording.tabId, startedAt: recording.startedAt } : null;
}

const control = (c: BrowserController, action: "start" | "stop") => {
  if (!c.window.isDestroyed()) c.window.webContents.send(Channels.recordingControl, action);
};

/** "Enregistrer une vidéo": starts recording the active tab, or stops the running recording. */
export function toggleRecording(c: BrowserController): void {
  if (recordings.has(c)) return control(c, "stop");
  const tabId = c.tabs.activeTabId;
  const tab = c.tabs.getState().tabs.find((item) => item.id === tabId);
  const contents = tabId ? c.tabs.pageOf(tabId) : null;
  if (!tab || !contents || contents.isDestroyed() || !/^(https?|file):/.test(tab.url)) return;
  requests.set(c, { tabId: tab.id, url: tab.url, contents });
  c.overlay.close();
  control(c, "start");
}

/** The UI's recorder runs: the address bar shows it from now on. */
function started(c: BrowserController): void {
  const request = requests.get(c);
  requests.delete(c);
  if (!request || request.contents.isDestroyed()) return control(c, "stop");
  recordings.set(c, { ...request, startedAt: Date.now() });
  // The tab closing ends the capture; stop cleanly so the file is still offered.
  request.contents.once("destroyed", () => {
    if (recordings.get(c)?.contents === request.contents) control(c, "stop");
  });
  c.spaces.refresh();
}

async function finish(c: BrowserController, data: unknown): Promise<boolean> {
  const recording = recordings.get(c);
  recordings.delete(c);
  if (!c.window.isDestroyed()) c.spaces.refresh();
  if (!recording || !isRecordingData(data) || c.window.isDestroyed()) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(c.window, {
    title: "Enregistrer la vidéo",
    defaultPath: join(downloadsFolder(), captureFileName(recording.url, new Date(recording.startedAt), "video")),
    filters: [{ name: "Vidéo WebM", extensions: ["webm"] }],
  });
  if (canceled || !filePath) return false;
  try {
    await writeFile(filePath, data);
    return true;
  } catch {
    return false;
  }
}

/** The UI session's display-media handler: only the tab main asked for, only for that window's chrome UI. */
export function installRecorder(): void {
  setDisplayCaptureGate((contents) => {
    const c = BrowserController.fromChrome(contents);
    return !!c && requests.has(c);
  });
  uiSession().setDisplayMediaRequestHandler((request, callback) => {
    const caller = request.frame ? allContents.fromFrame(request.frame) : undefined;
    const c = caller ? BrowserController.fromChrome(caller) : undefined;
    const pending = c && requests.get(c);
    if (!pending || pending.contents.isDestroyed()) {
      // Nothing asked for: refused (the UI never captures on its own).
      callback({});
      return;
    }
    const frame = pending.contents.mainFrame;
    callback(request.audioRequested ? { video: frame, audio: frame } : { video: frame });
  });
}

export const recordingFailed = (c: BrowserController) => void requests.delete(c);

/** A recording sent back by the UI: bytes, not too many. */
export const isRecordingData = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= MAX_RECORDING_BYTES;

export { started as recordingStarted, finish as finishRecording };
