import { Channels } from "@shared/ipc";
import { isLanguageCode } from "@shared/translate/languages";
import { isTranslateProviderId } from "@shared/translate/providers";
import { isTranslateRuleChange } from "@shared/translate/state";
import { keysStatus, setProviderKey, testProvider } from "../translate";
import { bool, bounds, defineHandlers, handle, handleUi, maxStr, nullable, on, str } from "./registry";

/**
 * Page translation (ADR-036): the UIs name tabs of their own window and languages by code; main
 * reads the page, calls the provider and keeps the keys (they never come back to the UI).
 */
export const translateHandlers = defineHandlers({
  [Channels.translateShow]: on([bounds], (c, anchor) => c.translator.showPopover(c.tabs.activeTabId, anchor), { from: "chrome" }),
  [Channels.translatePanel]: handle([str], (c, tabId) => c.translator.panelState(tabId)),
  [Channels.translateRun]: handle([str, nullable(isLanguageCode), isLanguageCode, bool], (c, tabId, from, to, consent) =>
    c.translator.translate(tabId, from, to, consent),
  ),
  [Channels.translateRestore]: on([str], (c, tabId) => void c.translator.restore(tabId)),
  [Channels.translateRule]: handle([str, isTranslateRuleChange, bool], (c, tabId, rule, enabled) => c.translator.setRule(tabId, rule, enabled)),
  [Channels.translateKeys]: handleUi([], () => keysStatus()),
  [Channels.translateSetKey]: handle([isTranslateProviderId, maxStr(500)], (_c, provider, key) => setProviderKey(provider, key), { privateRefused: true }),
  [Channels.translateTest]: handleUi([], () => testProvider()),
});
