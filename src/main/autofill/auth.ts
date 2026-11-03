import { dialog, systemPreferences } from "electron";
import type { WindowPort } from "../ports";

/**
 * Confirmation before a saved card number is shown (ADR-041): Touch ID on a Mac that has it,
 * otherwise a native dialog owned by the window (main asks itself: the UI alone cannot reveal).
 * Electron has no Windows Hello API for apps: Windows gets the dialog.
 */
export async function confirmCardReveal(c: WindowPort): Promise<boolean> {
  if (process.platform === "darwin" && systemPreferences.canPromptTouchID()) {
    try {
      await systemPreferences.promptTouchID("afficher le numéro d'une carte enregistrée");
      return true;
    } catch {
      return false;
    }
  }
  if (c.window.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(c.window, {
    type: "question",
    title: "Afficher le numéro de la carte",
    message: "Afficher le numéro complet de cette carte ?",
    detail: "Il restera visible sur la page des réglages jusqu'à ce que vous la quittiez.",
    buttons: ["Annuler", "Afficher"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return response === 1;
}
