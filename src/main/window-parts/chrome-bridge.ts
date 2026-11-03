import type { WebContents } from "electron";
import { Channels } from "@shared/ipc";
import type { BrowserState, UiCommand } from "@shared/types";
import type { OverlayPort } from "../ports";

/** The overlay as the bridge uses it (it pushes the same messages there). */
export interface BridgeOverlay extends OverlayPort {
  readonly isOpen: boolean;
  send(channel: string, ...args: unknown[]): void;
  raise(): void;
}

/**
 * The window's chrome UI webContents: a fixed app page (it never navigates nor opens windows), the
 * messages main pushes to it and the overlay (state, settings, UI commands), and the keyboard
 * shortcut capture of the settings (ADR-028).
 */
export class ChromeBridge {
  /** The settings are capturing a keyboard shortcut in the chrome UI (ADR-028). */
  capturingShortcut = false;

  /** `overlay` is read when a message goes out (the overlay is built after the bridge). */
  constructor(
    private readonly chrome: WebContents,
    private readonly overlay: () => BridgeOverlay,
  ) {
    chrome.on("will-navigate", (event) => event.preventDefault());
    chrome.setWindowOpenHandler(() => ({ action: "deny" }));
    // Shortcut capture in the settings (ADR-028): while it is on, key presses reach neither the
    // menu accelerators nor the page; main hands them to the chrome UI instead.
    chrome.on("before-input-event", (event, input) => {
      if (!this.capturingShortcut || input.type !== "keyDown") return;
      event.preventDefault();
      const { key, code, control, alt, shift, meta } = input;
      chrome.send(Channels.shortcutKey, { key, code, control, alt, shift, meta });
    });
    chrome.on("did-start-loading", () => (this.capturingShortcut = false));
  }

  /** Pushes a message to the chrome UI only. */
  toChrome(channel: string, ...args: unknown[]): void {
    if (!this.chrome.isDestroyed()) this.chrome.send(channel, ...args);
  }

  /** Pushes a message to every browser UI of the window (chrome and overlay). */
  send(channel: string, ...args: unknown[]): void {
    this.toChrome(channel, ...args);
    this.overlay().send(channel, ...args);
  }

  /** A new state of the window's spaces and tabs. */
  pushState(state: BrowserState): void {
    const overlay = this.overlay();
    this.send(Channels.state, state);
    // A tab view attached while the overlay is open must not cover it.
    if (overlay.isOpen) overlay.raise();
  }

  /** A command for the chrome UI: the overlay closes (it covers the UI) and the UI takes the focus. */
  command(command: UiCommand): void {
    this.overlay().close();
    // Shortcuts may fire while a web page has focus; UI commands need the chrome focused.
    this.chrome.focus();
    this.chrome.send(Channels.uiCommand, command);
  }
}
