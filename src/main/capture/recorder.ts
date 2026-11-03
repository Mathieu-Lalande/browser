import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dialog, webContents as allContents, type WebContents } from "electron";
import { Channels } from "@shared/ipc";
import { MAX_RECORDING_BYTES, captureFileName, type RecordingState } from "@shared/capture";
import type { WindowDirectory, WindowPort } from "../ports";
import { setDisplayCaptureGate, uiSession } from "../ui-session";

interface Request {
  tabId: string;
  url: string;
  contents: WebContents;
}

interface Recording extends Request {
  startedAt: number;
}

export interface TabRecorderDeps {
  windows: WindowDirectory;
  downloadsFolder: () => string;
}

/** A recording sent back by the UI: bytes, not too many. */
export const isRecordingData = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= MAX_RECORDING_BYTES;

/**
 * Tab recording (ADR-031). The chrome UI runs a MediaRecorder on `getDisplayMedia()`; the UI
 * session's display-media handler grants it exactly one source, the recorded tab's own frame
 * (Chromium tab capture: the page only, at its size, with its audio), and only right after main
 * asked for it. No picker, no screen or other window can be captured, and pages never get the
 * handler (their sessions refuse display capture, ADR-008). Main owns the state and saves the WebM.
 */
export class TabRecorder {
  /** Started from main, waiting for the UI's `getDisplayMedia` call. */
  private readonly requests = new WeakMap<WindowPort, Request>();
  private readonly recordings = new WeakMap<WindowPort, Recording>();

  constructor(private readonly deps: TabRecorderDeps) {}

  stateOf(c: WindowPort): RecordingState | null {
    const recording = this.recordings.get(c);
    return recording ? { tabId: recording.tabId, startedAt: recording.startedAt } : null;
  }

  /** "Enregistrer une vidéo": starts recording the active tab, or stops the running recording. */
  toggle(c: WindowPort): void {
    if (this.recordings.has(c)) return this.control(c, "stop");
    const tabId = c.tabs.activeTabId;
    const tab = c.tabs.getState().tabs.find((item) => item.id === tabId);
    const contents = tabId ? c.tabs.pageOf(tabId) : null;
    if (!tab || !contents || contents.isDestroyed() || !/^(https?|file):/.test(tab.url)) return;
    this.requests.set(c, { tabId: tab.id, url: tab.url, contents });
    c.overlay.close();
    this.control(c, "start");
  }

  /** The UI's recorder runs: the address bar shows it from now on. */
  started(c: WindowPort): void {
    const request = this.requests.get(c);
    this.requests.delete(c);
    if (!request || request.contents.isDestroyed()) return this.control(c, "stop");
    this.recordings.set(c, { ...request, startedAt: Date.now() });
    // The tab closing ends the capture; stop cleanly so the file is still offered.
    request.contents.once("destroyed", () => {
      if (this.recordings.get(c)?.contents === request.contents) this.control(c, "stop");
    });
    c.spaces.refresh();
  }

  failed(c: WindowPort): void {
    this.requests.delete(c);
  }

  async finish(c: WindowPort, data: unknown): Promise<boolean> {
    const recording = this.recordings.get(c);
    this.recordings.delete(c);
    if (!c.window.isDestroyed()) c.spaces.refresh();
    if (!recording || !isRecordingData(data) || c.window.isDestroyed()) return false;
    const { canceled, filePath } = await dialog.showSaveDialog(c.window, {
      title: "Enregistrer la vidéo",
      defaultPath: join(this.deps.downloadsFolder(), captureFileName(recording.url, new Date(recording.startedAt), "video")),
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
  install(): void {
    setDisplayCaptureGate((contents) => {
      const c = this.deps.windows.fromChrome(contents);
      return !!c && this.requests.has(c);
    });
    uiSession().setDisplayMediaRequestHandler((request, callback) => {
      const caller = request.frame ? allContents.fromFrame(request.frame) : undefined;
      const c = caller ? this.deps.windows.fromChrome(caller) : undefined;
      const pending = c && this.requests.get(c);
      if (!pending || pending.contents.isDestroyed()) {
        // Nothing asked for: refused (the UI never captures on its own).
        callback({});
        return;
      }
      const frame = pending.contents.mainFrame;
      callback(request.audioRequested ? { video: frame, audio: frame } : { video: frame });
    });
  }

  private control(c: WindowPort, action: "start" | "stop"): void {
    if (!c.window.isDestroyed()) c.window.webContents.send(Channels.recordingControl, action);
  }
}
