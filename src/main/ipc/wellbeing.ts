import { Channels } from "@shared/ipc";
import { MAX_FOCUS_MINUTES } from "@shared/focus";
import { MAX_SESSION_NAME, isSavedSessionId } from "@shared/saved-sessions";
import { clearSiteTime, listSessions, removeSession, saveSession, sessionTabs, setFocus, siteTimeSummary } from "../wellbeing";
import type { BrowserController } from "../window";
import { custom, defineHandlers, handle, intIn, maxStr, nullable, on, opt } from "./registry";

const sessionId = custom<string>(isSavedSessionId);
/** Private windows: nothing is written (ADR-014). */
const priv = { privateRefused: true } as const;

/** Opens a saved session in the window: its pages in a folder named after it, the first one shown. */
function openSession(c: BrowserController, id: string): void {
  const session = sessionTabs(id);
  if (!session) return;
  const ids = session.tabs.map((tab, index) => c.tabs.create(tab.url, { activate: index === 0 }));
  c.tabs.createFolder({ name: session.name }, null, ids);
}

/** "Concentration" (ADR-059): focus sessions, time per site, named sessions. */
export const wellbeingHandlers = defineHandlers({
  [Channels.focusStart]: on([nullable(intIn(1, MAX_FOCUS_MINUTES))], (_c, minutes) => void setFocus(minutes)),
  [Channels.siteTimeSummary]: handle([opt(intIn(1, 30))], (_c, days) => siteTimeSummary(days), { ...priv, fallback: { sites: [], days: [], totalMs: 0 } }),
  [Channels.siteTimeClear]: on([], () => clearSiteTime(), priv),
  [Channels.sessionsList]: handle([], () => listSessions(), { ...priv, fallback: [] }),
  [Channels.sessionsSave]: handle([maxStr(MAX_SESSION_NAME * 4)], (c, name) => saveSession(c, name), { ...priv, fallback: null }),
  [Channels.sessionsRemove]: handle([sessionId], (_c, id) => removeSession(id), { ...priv, fallback: [] }),
  [Channels.sessionsOpen]: on([sessionId], (c, id) => openSession(c, id), priv),
});
