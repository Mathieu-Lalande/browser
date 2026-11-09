import type { ReaderArticle } from "@shared/reader";
import { useState } from "react";
import { Alert } from "react-native";
import { readerToken } from "../lib/reader";
import type { MobileTab } from "../lib/tabs";
import { useEvent } from "./useEvent";

/**
 * Reader mode (ADR-026): `open` asks the tab's page for its article (`request`, sent to its
 * WebView), the answer shows the reader. `shown` is the article while its tab is on screen
 * (`visible`) and still on that page.
 */
export function useReader({
  tab,
  visible,
  onAssistantArticle,
  onReadingArticle,
}: {
  tab: MobileTab | null;
  visible: boolean;
  /** The same extraction, asked by the assistant (ADR-044): the article goes to it, not to the reader. */
  onAssistantArticle?: (tabId: string, article: ReaderArticle | null) => void;
  /** The same extraction, for a page just added to the reading list (ADR-047): its offline text. */
  onReadingArticle?: (tabId: string, article: ReaderArticle | null) => void;
}) {
  const [request, setRequest] = useState<{ tabId: string; token: string; purpose: "reader" | "assistant" | "reading" } | null>(null);
  const [reader, setReader] = useState<{ tabId: string; article: ReaderArticle; offline?: boolean } | null>(null);

  const open = useEvent((tabId: string, purpose: "reader" | "assistant" | "reading" = "reader") => setRequest({ tabId, token: readerToken(), purpose }));

  const onArticle = useEvent((tabId: string, article: ReaderArticle | null) => {
    const purpose = request?.purpose;
    setRequest(null);
    if (purpose === "assistant") return onAssistantArticle?.(tabId, article);
    if (purpose === "reading") return onReadingArticle?.(tabId, article);
    if (tabId !== tab?.id) return;
    if (article) setReader({ tabId, article });
    else Alert.alert("Mode lecture indisponible", "Aucun article n'a été trouvé sur cette page.");
  });

  const close = useEvent(() => setReader(null));

  const shown = reader && visible && reader.tabId === tab?.id && (reader.offline || reader.article.url === tab.url) ? reader.article : null;

  /** Shows an article that is not the tab's page (an offline reading list copy). */
  const show = useEvent((article: ReaderArticle) => tab && setReader({ tabId: tab.id, article, offline: true }));

  return { request, shown, open, onArticle, close, show };
}
