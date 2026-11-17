/**
 * "Installer comme application" (ADR-059): a site gets its own shortcut (Windows: Desktop and Start
 * menu `.lnk`; Linux: a `.desktop` entry) that launches the browser with `--app=<url>`, which opens
 * the site alone in an app window (the mini window of ADR-048, promotable to a tab). Pure: the
 * switch, the shortcut's name, the icon file and the Linux entry. No Electron here.
 */

export const APP_SWITCH = "--app=";
const MAX_NAME = 60;

/** The site an `--app=` switch asks for: http(s) only. */
export function parseAppSwitch(argv: readonly string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (!arg.startsWith(APP_SWITCH)) continue;
    const value = arg.slice(APP_SWITCH.length);
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch {
      // Not a URL: ignored.
    }
  }
  return null;
}

/** A file name for the shortcut: the page title (or host), without characters Windows refuses. */
export function shortcutName(title: string, url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    host = "App";
  }
  // eslint-disable-next-line no-control-regex
  const clean = title.replace(/[\u0000-\u001f<>:"/\\|?*]+/gu, " ").replace(/\s+/gu, " ").trim();
  const base = clean.split(/ [-–—|·:] /u)[0].trim() || host;
  return base.slice(0, MAX_NAME).replace(/[. ]+$/u, "") || host;
}

/** The arguments of the shortcut: the app path when unpackaged (Electron runs it), the profile, the site. */
export function webAppArgs(url: string, options: { appPath?: string; profile?: string } = {}): string[] {
  return [...(options.appPath ? [options.appPath] : []), ...(options.profile ? [`--profile=${options.profile}`] : []), `${APP_SWITCH}${url}`];
}

/** Quotes one argument of a Windows command line (`.lnk` args, `.desktop` Exec). */
export const quoteArg = (arg: string): string => (/[\s"]/u.test(arg) ? `"${arg.replace(/"/gu, '\\"')}"` : arg);

/** An `.ico` holding one PNG image (Vista+ reads PNG entries): what a `.lnk` icon needs. */
export function icoFromPng(png: Uint8Array, size: number): Uint8Array {
  const header = new Uint8Array(6 + 16);
  const view = new DataView(header.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, 1, true); // one image
  header[6] = size >= 256 ? 0 : size; // width (0 = 256)
  header[7] = size >= 256 ? 0 : size; // height
  header[8] = 0; // palette
  header[9] = 0; // reserved
  view.setUint16(10, 1, true); // planes
  view.setUint16(12, 32, true); // bits per pixel
  view.setUint32(14, png.length, true); // image size
  view.setUint32(18, header.length, true); // offset of the image
  const out = new Uint8Array(header.length + png.length);
  out.set(header, 0);
  out.set(png, header.length);
  return out;
}

/** The Linux `.desktop` entry of a web app. */
export function desktopEntry(name: string, exec: string, args: readonly string[], icon: string | null): string {
  const escape = (value: string) => value.replace(/[\n\r]/gu, " ");
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${escape(name)}`,
    `Exec=${[exec, ...args].map(quoteArg).join(" ")}`,
    ...(icon ? [`Icon=${icon}`] : []),
    "Terminal=false",
    "Categories=Network;WebBrowser;",
    "",
  ].join("\n");
}
