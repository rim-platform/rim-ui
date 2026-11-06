import { useCallback, useRef, useState } from "react";

/** How many groups read their messages at once. */
export const GROUPS_LOADING_AT_ONCE = 4;

interface LoadQueue {
  /** Whether a group may read its messages now. */
  isStarted: (key: string) => boolean;
  /** A group came into view. */
  request: (key: string) => void;
  /** A group's first read has answered, which lets the next one start. */
  settle: (key: string) => void;
}

/**
 * Starts groups as they come into view, at most `limit` reading at once and in the order they
 * asked. A started group stays started.
 */
export function useLoadQueue(limit = GROUPS_LOADING_AT_ONCE): LoadQueue {
  const [started, setStarted] = useState<ReadonlySet<string>>(new Set());
  const waiting = useRef<string[]>([]);
  const loading = useRef(new Set<string>());
  const known = useRef(new Set<string>());

  const pump = useCallback(() => {
    const begun: string[] = [];
    while (loading.current.size < limit && waiting.current.length > 0) {
      const key = waiting.current.shift()!;
      loading.current.add(key);
      begun.push(key);
    }
    if (begun.length > 0) setStarted((previous) => new Set([...previous, ...begun]));
  }, [limit]);

  const request = useCallback(
    (key: string) => {
      if (known.current.has(key)) return;
      known.current.add(key);
      waiting.current.push(key);
      pump();
    },
    [pump],
  );

  const settle = useCallback(
    (key: string) => {
      if (loading.current.delete(key)) pump();
    },
    [pump],
  );

  const isStarted = useCallback((key: string) => started.has(key), [started]);
  return { isStarted, request, settle };
}
