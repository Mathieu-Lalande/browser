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
export function useReader({ tab, visible }: { tab: MobileTab | null; visible: boolean }) {
  const [request, setRequest] = useState<{ tabId: string; token: string } | null>(null);
  const [reader, setReader] = useState<{ tabId: string; article: ReaderArticle } | null>(null);

  const open = useEvent((tabId: string) => setRequest({ tabId, token: readerToken() }));

  const onArticle = useEvent((tabId: string, article: ReaderArticle | null) => {
    setRequest(null);
    if (tabId !== tab?.id) return;
    if (article) setReader({ tabId, article });
    else Alert.alert("Mode lecture indisponible", "Aucun article n'a été trouvé sur cette page.");
  });

  const close = useEvent(() => setReader(null));

  const shown = reader && visible && reader.tabId === tab?.id && reader.article.url === tab.url ? reader.article : null;

  return { request, shown, open, onArticle, close };
}
