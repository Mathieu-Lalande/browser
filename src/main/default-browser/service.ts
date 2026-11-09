import { t } from "@shared/i18n";
import type { DefaultBrowserStatus } from "@shared/default-browser";

/** What the OS offers (Electron's `app` and `shell`, injected: testable with fakes). */
export interface DefaultClientPort {
  platform: NodeJS.Platform;
  /** Only an installed (packaged) app registers itself: a dev run must not take over the user's links. */
  packaged: boolean;
  appName: string;
  isDefaultProtocolClient(protocol: string): boolean;
  setAsDefaultProtocolClient(protocol: string): boolean;
  /** The name of the app the OS opens `url` with (Windows: honors the user's choice in Settings). */
  defaultAppNameFor(url: string): string;
  openExternal(url: string): Promise<void>;
}

const PROTOCOLS = ["http", "https"] as const;

/**
 * Windows 10/11 never lets an app make itself the default: it is registered by the installer
 * (`build/installer.nsh`: Capabilities + RegisteredApplications) and the user picks it in the
 * Settings app, opened on the browser's own page.
 */
export const WINDOWS_DEFAULT_APPS_URL = "ms-settings:defaultapps?registeredAppUser=Browser";

/**
 * "Navigateur par défaut" (ADR-039): whether this browser handles web links, and asking the OS to
 * make it so (macOS asks the user itself, Linux sets the `x-scheme-handler`s, Windows opens Settings).
 */
export class DefaultBrowserService {
  constructor(private readonly port: DefaultClientPort) {}

  status(): DefaultBrowserStatus {
    if (!this.port.packaged) return { state: "unavailable", message: t("defaultBrowserService.availableInstalledVersionBrowser") };
    return { state: this.isDefault() ? "default" : "not-default", message: null };
  }

  /** Asks the OS; resolves to the status right after (Windows: the user still has to choose in Settings). */
  async makeDefault(): Promise<DefaultBrowserStatus> {
    if (!this.port.packaged) return this.status();
    if (this.port.platform !== "win32") {
      for (const protocol of PROTOCOLS) this.port.setAsDefaultProtocolClient(protocol);
      return this.status();
    }
    await this.port.openExternal(WINDOWS_DEFAULT_APPS_URL).catch(() => {});
    const status = this.status();
    return status.state === "default" ? status : { state: "not-default", message: t("defaultBrowserService.chooseBrowserWindowsSettings") };
  }

  private isDefault(): boolean {
    // Windows: the registry key Electron checks is written by our installer whatever the user chose.
    if (this.port.platform === "win32") {
      const name = this.port.appName.toLowerCase();
      return PROTOCOLS.every((protocol) => this.port.defaultAppNameFor(`${protocol}://`).toLowerCase() === name);
    }
    return PROTOCOLS.every((protocol) => this.port.isDefaultProtocolClient(protocol));
  }
}
