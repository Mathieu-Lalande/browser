import { t } from "@shared/i18n";
import { app, BrowserWindow, dialog, type Session } from "electron";
import { webauthnChoices } from "@shared/webauthn";
import type { SessionService } from "./services";

/**
 * Passkeys (ADR-041). Per session: the account chooser Electron asks for when several passkeys
 * match (`select-webauthn-account`; without a listener the request fails). Once at startup on
 * macOS: Touch ID, when this build names a keychain access group its signed entitlements allow
 * (`touchIdKeychainGroup`); otherwise macOS has no platform authenticator. See `@shared/webauthn`
 * for what each system supports.
 */
export class PasskeyService implements SessionService {
  private readonly sessions = new WeakSet<Session>();

  constructor(private readonly options: { platform: string; touchIdKeychainGroup?: string | null }) {}

  /** Whether Touch ID was configured (`app.configureWebAuthn`, macOS only). */
  configurePlatform(): boolean {
    const group = this.options.touchIdKeychainGroup;
    if (this.options.platform !== "darwin" || !group) return false;
    try {
      app.configureWebAuthn({ touchID: { keychainAccessGroup: group, promptReason: t("webauthn.sign1") } });
      return true;
    } catch {
      return false;
    }
  }

  install(ses: Session): void {
    if (this.sessions.has(ses)) return;
    this.sessions.add(ses);
    ses.on("select-webauthn-account", (_event, details, callback) => {
      const choices = webauthnChoices(details.accounts);
      if (!choices.length) return callback();
      const owner = BrowserWindow.getFocusedWindow();
      const options = {
        type: "question" as const,
        title: t("webauthn.passkeys"),
        message: t("webauthn.chooseAccountUse", { relyingPartyId: details.relyingPartyId }),
        buttons: [...choices.map((choice) => choice.label), t("webauthn.cancel")],
        cancelId: choices.length,
        defaultId: 0,
        noLink: true,
      };
      const shown = owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
      shown.then(
        ({ response }) => callback(choices[response]?.credentialId),
        () => callback(),
      );
    });
  }
}
