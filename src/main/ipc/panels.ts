import { t } from "@shared/i18n";
import { Channels } from "@shared/ipc";
import { MAX_PANEL_TITLE, isPanelId, type PanelAddResult } from "@shared/panels";
import { isReadingId } from "@shared/reading-list";
import { appServices } from "../app-services-ref";
import { bool, bounds, custom, defineHandlers, handle, int, maxStr, nullable, num, on, opt, str } from "./registry";

const panelId = custom<string>(isPanelId);
const readingId = custom<string>(isReadingId);
/** A private window has no panels and no reading list (ADR-014): refused before any handler runs. */
const priv = { privateRefused: true } as const;

/** Web panels (ADR-047): the list is the profile's, the live pages are the sender's window's. */
export const panelHandlers = defineHandlers({
  [Channels.panelsAdd]: handle(
    [maxStr(4096), opt(maxStr(MAX_PANEL_TITLE * 4)), opt(bool)],
    (_c, url, title, mobile): PanelAddResult => appServices().panels.add({ url, title, mobile }),
    { ...priv, fallback: { ok: false, get message() { return t("panels.unavailable") } } },
  ),
  [Channels.panelsRemove]: on([panelId], (_c, id) => appServices().panels.remove(id), priv),
  [Channels.panelsMove]: on([panelId, int], (_c, id, index) => appServices().panels.move(id, index), priv),
  [Channels.panelsSetWidth]: on([panelId, num], (_c, id, width) => appServices().panels.update(id, { width }), priv),
  [Channels.panelsSetMobile]: on([panelId, bool], (_c, id, mobile) => appServices().panels.update(id, { mobile }), priv),
  [Channels.panelsToggle]: on([opt(panelId)], (c, id) => c.panels.toggle(id), priv),
  [Channels.panelsClose]: on([], (c) => c.panels.close()),
  [Channels.panelsBounds]: on([nullable(bounds)], (c, rect) => c.panels.setBounds(rect), { from: "chrome" }),
  [Channels.panelsReload]: on([panelId], (c, id) => c.panels.reload(id), priv),
  [Channels.panelsContextMenu]: on([panelId], (c, id) => c.panels.contextMenu(id), priv),
});

/** The reading list (ADR-047): items are named by id, tabs by the sender window's ids. */
export const readingHandlers = defineHandlers({
  [Channels.readingList]: handle([], () => appServices().reading.entries(), { ...priv, fallback: [] }),
  [Channels.readingGet]: handle([readingId], (_c, id) => appServices().reading.get(id), { ...priv, fallback: null }),
  [Channels.readingToggleTab]: handle([str], (c, tabId) => appServices().reading.toggleTab(c, tabId), { ...priv, fallback: null }),
  [Channels.readingSetRead]: on([readingId, bool], (_c, id, read) => appServices().reading.setRead(id, read), priv),
  [Channels.readingRemove]: on([readingId], (_c, id) => appServices().reading.remove(id), priv),
});
