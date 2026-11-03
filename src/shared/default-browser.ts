/** Default browser status (ADR-039), as `browser://settings` shows it. */
export interface DefaultBrowserStatus {
  /** `unavailable`: an unpackaged (dev) run, which never registers itself. */
  state: "default" | "not-default" | "unavailable";
  /** French, shown under the row. */
  message: string | null;
}
