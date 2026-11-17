import { t } from "@shared/i18n";
import { app, dialog, systemPreferences } from "electron";
import type { WindowPort } from "../ports";

/**
 * Confirmation that the person at the keyboard wants a secret shown (ADR-041, ADR-059): Touch ID
 * on a Mac that has it, otherwise a native dialog owned by the window (main asks itself: the UI
 * alone cannot reveal). Electron has no Windows Hello API for apps: Windows gets the dialog.
 */
async function confirmIdentity(c: WindowPort, texts: { touchId: string; title: string; message: string; detail: string; action: string }): Promise<boolean> {
  if (process.platform === "darwin" && systemPreferences.canPromptTouchID()) {
    try {
      await systemPreferences.promptTouchID(texts.touchId);
      return true;
    } catch {
      return false;
    }
  }
  if (c.window.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(c.window, {
    type: "question",
    title: texts.title,
    message: texts.message,
    detail: texts.detail,
    buttons: [t("autofillAuth.cancel"), texts.action],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return response === 1;
}

export const confirmCardReveal = (c: WindowPort): Promise<boolean> =>
  confirmIdentity(c, {
    touchId: t("autofillAuth.showNumberSavedCard"),
    title: t("autofillAuth.showCardNumber"),
    message: t("autofillAuth.showFullNumberCard"),
    detail: t("autofillAuth.willStayVisibleSettings"),
    action: t("autofillAuth.show"),
  });

/** Unlocking the password vault after its lock delay (ADR-059). Dev-only hook `BROWSER_TEST_VAULT_UNLOCK`. */
export const confirmVaultUnlock = (c: WindowPort): Promise<boolean> => {
  const forced = app.isPackaged ? undefined : process.env.BROWSER_TEST_VAULT_UNLOCK;
  if (forced) return Promise.resolve(forced === "1");
  return confirmIdentity(c, {
    touchId: t("vaultLock.touchId"),
    title: t("vaultLock.title"),
    message: t("vaultLock.message"),
    detail: t("vaultLock.detail"),
    action: t("vaultLock.unlock"),
  });
};
