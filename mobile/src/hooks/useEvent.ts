import { useCallback, useRef } from "react";

/** Stable callback that always sees the latest props (for WebView handlers). */
export function useEvent<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const ref = useRef(handler);
  ref.current = handler;
  return useCallback((...args: A) => ref.current(...args), []);
}
