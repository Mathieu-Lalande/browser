/**
 * Passkeys and security keys (WebAuthn, ADR-041): what Electron 44 makes possible on each system,
 * and the account chooser's model. Pure.
 *
 * - Windows: Chromium hands every request to the system's WebAuthn API (webauthn.dll): Windows
 *   Hello (passkeys on this PC), USB/NFC security keys with their PIN, and phones (QR code) all
 *   go through the system's own dialogs.
 * - macOS: the Touch ID platform authenticator only once `app.configureWebAuthn` is given a
 *   keychain access group that the signed app's entitlements also list; security keys over USB
 *   work through Chromium's own HID stack, without a PIN dialog (keys that require a PIN fail).
 *   No iCloud Keychain passkeys, no phone (hybrid) sign-in.
 * - Linux: USB security keys through hidraw (udev rules giving the user access), no PIN dialog,
 *   no platform authenticator.
 * WebAuthn is not a permission of Electron's session handlers: nothing to allow there, and
 * cross-origin frames still need `allow="publickey-credentials-get"` (enforced by Chromium).
 */

import { t } from "./i18n";

export type WebAuthnMethod = "platform" | "security-key" | "security-key-pin" | "phone";

export interface WebAuthnSupport {
  platform: boolean;
  securityKey: boolean;
  /** Security keys that ask for a PIN or fingerprint (user verification). */
  securityKeyPin: boolean;
  /** Signing in with a phone (QR code, "hybrid"). */
  phone: boolean;
}

/** What works on `platform` (`process.platform`), `touchId`: macOS Touch ID configured for this build. */
export function webauthnSupport(platform: string, touchId = false): WebAuthnSupport {
  if (platform === "win32") return { platform: true, securityKey: true, securityKeyPin: true, phone: true };
  if (platform === "darwin") return { platform: touchId, securityKey: true, securityKeyPin: false, phone: false };
  return { platform: false, securityKey: true, securityKeyPin: false, phone: false };
}

export interface WebAuthnAccountChoice {
  credentialId: string;
  label: string;
}

/** Most accounts a native chooser lists (buttons). */
export const MAX_WEBAUTHN_ACCOUNTS = 6;

/**
 * The buttons of the account chooser when several passkeys match: "name (display name)", deduped
 * labels kept apart by order; at most `MAX_WEBAUTHN_ACCOUNTS`.
 */
export function webauthnChoices(accounts: readonly { credentialId: string; name?: string; displayName?: string }[]): WebAuthnAccountChoice[] {
  return accounts.slice(0, MAX_WEBAUTHN_ACCOUNTS).map((account, index) => {
    const name = account.name?.trim() ?? "";
    const display = account.displayName?.trim() ?? "";
    const label = name && display && name !== display ? `${display} (${name})` : name || display || t("webauthn.passkey", { p: index + 1 });
    return { credentialId: account.credentialId, label: label.slice(0, 80) };
  });
}
