import { useEffect, useRef, useState } from "react";
import type { FindResult, FindStep } from "../lib/findInPage";
import { useEvent } from "./useEvent";

type FindAction = "search" | FindStep | "clear";
export type FindRequest = { seq: number; action: FindAction; query: string };

/**
 * "Rechercher dans la page" (ADR-055): the bar's state and the requests sent to the active tab's
 * WebView. Closing the bar, leaving the tab or a new document clears the marks.
 */
export function useFindInPage(activeTabId: string | undefined) {
  const [tabId, setTabId] = useState<string | null>(null);
  const [result, setResult] = useState<FindResult | null>(null);
  const [requests, setRequests] = useState<Readonly<Record<string, FindRequest>>>({});
  const seq = useRef(0);

  const send = (target: string, action: FindAction, query = "") => {
    seq.current += 1;
    setRequests((current) => ({ ...current, [target]: { seq: seq.current, action, query } }));
  };

  const open = useEvent(() => {
    if (!activeTabId) return;
    setTabId(activeTabId);
    setResult(null);
  });
  const close = useEvent(() => {
    if (tabId) send(tabId, "clear");
    setTabId(null);
    setResult(null);
  });
  const search = useEvent((query: string) => {
    if (!tabId) return;
    setResult(null);
    if (query.trim()) send(tabId, "search", query);
    else send(tabId, "clear");
  });
  const step = useEvent((direction: FindStep) => tabId && send(tabId, direction));
  const onResult = useEvent((from: string, found: FindResult | null) => {
    if (from !== tabId) return;
    // A new document: its marks are gone, so is the bar.
    if (found === null) {
      setTabId(null);
      setResult(null);
    } else setResult(found);
  });

  // Another tab came on screen: the search belonged to the previous one.
  useEffect(() => {
    if (tabId && activeTabId !== tabId) close();
  }, [activeTabId, tabId, close]);

  return { shown: tabId !== null, result, requests, open, close, search, step, onResult };
}
