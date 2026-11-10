/**
 * The channels of the extension API bridge (ADR-053), between the extension-context preload
 * (`src/preload/extension-api.ts`) and main (`src/main/extensions/api/`). Kept out of `ipc.ts` on
 * purpose: they are not the browser UI's (`BrowserApi`), and the extension preload must bundle
 * nothing but this file (a sandboxed preload cannot load a shared chunk).
 */
export const EXTENSION_CHANNELS = {
  /** invoke(namespace, method, args[]): one `chrome.*` call. */
  call: "crx:call",
  /** send(event): the context listens to `event` (e.g. "tabs.onCreated"). */
  listen: "crx:listen",
  /** main → context: (event, args[]). */
  event: "crx:event",
} as const;
