import { useQueries } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { blockedConversationIdsIn } from "../../relay/state/useBlockedConversations";
import {
  fetchMessageSearchPage,
  useDebouncedQuery,
  type SearchMessageItem,
} from "./useSearchMessages";

/** The shortest text, after the debounce, that searches every workspace. */
export const ACROSS_MIN_LENGTH = 2;
/** The most workspaces one pause in typing searches. */
export const ACROSS_MAX_WORKSPACES = 10;
/** How long one workspace's search may take before it counts as failed. */
export const ACROSS_TIMEOUT_MS = 8_000;
/** The most matches asked of each workspace, and shown in all. */
export const ACROSS_LIMIT = 5;

/** One workspace's answer: its matches, or that it failed or took too long. */
export type WorkspaceSearch = { items: SearchMessageItem[] } | { failed: true };

/**
 * Searches one workspace's messages. A failure, or no answer within `timeoutMs`, comes back as
 * `{ failed: true }` rather than an error, so it never reaches the query cache's error handling;
 * only an abort through `signal` throws.
 *
 * @param workspaceId - The workspace searched; the request goes to its own host.
 * @param query - The text with its operators.
 * @param signal - Aborts the request when the text changes.
 * @param timeoutMs - How long to wait for an answer.
 */
export async function searchWorkspace(
  workspaceId: string,
  query: string,
  signal?: AbortSignal,
  timeoutMs = ACROSS_TIMEOUT_MS,
): Promise<WorkspaceSearch> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  signal?.addEventListener("abort", abort);
  // Ends the wait on an abort or the timeout even where the transport does not take the signal,
  // as with a workspace on another server.
  const stopped = new Promise<never>((_, reject) =>
    controller.signal.addEventListener("abort", () =>
      reject(new DOMException("The search was stopped.", "AbortError")),
    ),
  );
  stopped.catch(() => {});
  try {
    const page = await Promise.race([
      fetchMessageSearchPage(workspaceId, query, ACROSS_LIMIT, controller.signal),
      stopped,
    ]);
    return { items: page.items };
  } catch (err) {
    if (signal?.aborted) throw err;
    return { failed: true };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * The workspaces to search, in order: the open one first, then the rest in rail order.
 *
 * @param railOrder - Every workspace and direct space, as the rail lists them.
 * @param openId - The open workspace.
 */
export function searchOrder(railOrder: readonly string[], openId: string | null): string[] {
  const unique = [...new Set(railOrder)];
  return openId && unique.includes(openId)
    ? [openId, ...unique.filter((id) => id !== openId)]
    : unique;
}

/**
 * Message search across workspaces: once the text has paused and is at least
 * {@link ACROSS_MIN_LENGTH} long, each of the first {@link ACROSS_MAX_WORKSPACES} of `ordered`
 * is asked for its newest matches, and the newest {@link ACROSS_LIMIT} of all are kept. A new
 * text aborts the requests still running. Conversations the person blocked are left out.
 *
 * @param query - The text as typed.
 * @param ordered - The workspaces in the order to search them.
 * @param enabled - Whether to search at all.
 */
export function useMessagesAcrossWorkspaces(
  query: string,
  ordered: readonly string[],
  enabled: boolean,
) {
  const debounced = useDebouncedQuery(query).trim();
  const run = enabled && debounced.length >= ACROSS_MIN_LENGTH;
  const searched = run ? ordered.slice(0, ACROSS_MAX_WORKSPACES) : [];
  const results = useQueries({
    queries: searched.map((workspaceId) => ({
      queryKey: queryKeys.searchBoxMessages(workspaceId, debounced),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        searchWorkspace(workspaceId, debounced, signal),
      staleTime: 15_000,
      retry: false,
    })),
  });

  const items = results
    .flatMap(({ data }) => (data && "items" in data ? data.items : []))
    .filter((item) => !blockedConversationIdsIn(item.serverId).has(item.conversationId))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    .slice(0, ACROSS_LIMIT);
  const failed = searched.filter((_, i) => {
    const data = results[i]?.data;
    return Boolean(data && "failed" in data);
  });

  return {
    items,
    /** The workspaces that failed or took too long, in search order. */
    failed,
    /** How many workspaces were searched, and how many there are. */
    searchedCount: searched.length,
    total: ordered.length,
    /** Whether the text is too short to search every workspace. */
    tooShort: enabled && query.trim().length > 0 && debounced.length < ACROSS_MIN_LENGTH,
    isPending: run && results.some((r) => r.isPending),
  };
}
