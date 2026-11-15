import { t } from "@shared/i18n";
import type { ShortcutIssue } from "@shared/extension-commands";

/**
 * Why an extension shortcut is not installed (`status`, ADR-054), or why the shortcut editor
 * refuses a key the user pressed (`refusal`, ADR-057).
 */
export function shortcutIssueText(issue: ShortcutIssue, mode: "status" | "refusal" = "status"): string {
  const refusal = mode === "refusal";
  switch (issue.kind) {
    case "browser":
      return t(refusal ? "extensionShortcutsEditor.takenByBrowser" : "extensionRow.shortcutTakenByBrowser", { label: issue.label });
    case "extension":
      return t(refusal ? "extensionShortcutsEditor.takenByExtension" : "extensionRow.shortcutTakenByExtension", { name: issue.name });
    case "reserved":
      return t(refusal ? "extensionShortcutsEditor.reserved" : "extensionRow.shortcutReserved");
    case "limit":
      return t("extensionRow.shortcutLimit");
    default:
      return t(refusal ? "extensionShortcutsEditor.invalid" : "extensionRow.shortcutInvalid");
  }
}
