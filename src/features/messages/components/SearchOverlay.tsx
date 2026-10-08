import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, Loader2, X, Clock, Info } from "lucide-react";

import { Z } from "../../../shared/ui/zIndex";
import { cn } from "../../../shared/ui/cn";
import { useSearchOverlayStore } from "../state/useSearchOverlayStore";
import {
  useSearchMessages,
  useLocalSearchHits,
  type SearchMessageItem,
} from "../api/useSearchMessages";
import {
  buildConversationDirectory,
  hiddenLocalConversations,
  mergeSearchResults,
} from "../api/localSearch";
import { requestCacheSync } from "../runtime/messageCacheSync";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useChannels, useJoinedChannels } from "../../conversations/api/useChannels";
import { useInboxConversations } from "../../conversations/api/useInboxConversations";
import { formatRelativeTime } from "../../../shared/utils/formatTime";
import { SearchSnippet } from "./SearchSnippet";

/** Operator legend shown in the "Search tips" popover. Mirrors `../rim-server/docs/search.md`. */
const SEARCH_OPERATORS: { operator: string; example: string; meaning: string }[] = [
  { operator: "from:", example: "from:@alice", meaning: "Only messages from this user." },
  { operator: "in:", example: "in:#general", meaning: "Only messages in this channel." },
  { operator: "has:link", example: "has:link", meaning: "Only messages containing a URL." },
  {
    operator: "has:attachment",
    example: "has:attachment",
    meaning: "Only messages with an attachment.",
  },
  { operator: "before:", example: "before:2026-07-01", meaning: "Sent before this date." },
  { operator: "after:", example: "after:2026-06-01", meaning: "Sent on or after this date." },
];

const PREFETCH_THRESHOLD = 5;

export function SearchOverlay() {
  const isOpen = useSearchOverlayStore((s) => s.isOpen);
  const query = useSearchOverlayStore((s) => s.query);
  const scope = useSearchOverlayStore((s) => s.scope);
  const recentSearches = useSearchOverlayStore((s) => s.recentSearches);
  const setQuery = useSearchOverlayStore((s) => s.setQuery);
  const close = useSearchOverlayStore((s) => s.close);
  const addRecentSearch = useSearchOverlayStore((s) => s.addRecentSearch);

  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setSelectedConversationId = useShellStore((s) => s.setSelectedConversationId);
  const setHighlightedMessageId = useShellStore((s) => s.setHighlightedMessageId);
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const openThreadForMessage = useShellStore((s) => s.openThreadForMessage);
  const { data: channelsData } = useChannels(workspaceId ?? undefined);
  const { data: joinedData } = useJoinedChannels(workspaceId ?? undefined);
  const { data: inboxData } = useInboxConversations(workspaceId ?? undefined);
  // The conversations the user can see now: titles for local hits, `in:#name` for local
  // search, and the visibility check before a local hit joins the server's results.
  const directory = useMemo(
    () => buildConversationDirectory([channelsData?.items, joinedData?.items, inboxData?.items]),
    [channelsData, joinedData, inboxData],
  );

  // The scope chip (All / current channel) sets `conversationId` as an explicit
  // query-input field. It coexists with an in-query `in:#x` operator — the
  // backend intersects both rather than one overriding the other. We don't try
  // to unify them into a single UI control; a user can narrow with the chip,
  // the operator, or both.
  const conversationId = scope.kind === "conversation" ? scope.conversationId : undefined;
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSearchMessages(workspaceId ?? undefined, conversationId, query, directory);
  // Desktop app: matches from the local search index (PR 10), added to the server's results.
  const { data: localHits } = useLocalSearchHits(
    workspaceId ?? undefined,
    conversationId,
    query,
    directory,
  );

  const flatResults = useMemo(
    () => mergeSearchResults(data?.pages ?? [], hasNextPage, localHits ?? [], directory),
    [data, hasNextPage, localHits, directory],
  );
  const isOffline = data?.pages.some((page) => page.source === "local") ?? false;

  // Local hits from a conversation the lists no longer show are kept out of the results; ask
  // the cache to re-check those conversations, which drops them if access was lost.
  useEffect(() => {
    if (!workspaceId || !localHits || directory.byId.size === 0) return;
    const hidden = hiddenLocalConversations(localHits, directory);
    if (hidden.length > 0) requestCacheSync(workspaceId, hidden);
  }, [workspaceId, localHits, directory]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tipsOpen, setTipsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Channel name lookup
  const channelNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (channelsData) {
      for (const ch of channelsData.items) {
        map.set(ch.id, ch.title ?? ch.id);
      }
    }
    return map;
  }, [channelsData]);

  // Total keyboard-navigable rows: the flat results, plus one extra "Load
  // more" row while another page is available.
  const navCount = flatResults.length + (hasNextPage ? 1 : 0);
  const isLoadMoreSelected = hasNextPage && selectedIndex === flatResults.length;

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Reset selection whenever the user starts a new search. (Not on `data`
  // change — that also fires when a page is appended via fetchNextPage, and
  // resetting then would fight the user's in-progress keyboard navigation.)
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected row into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-search-result]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Infinite scroll: prefetch the next page once the selected row is within
  // PREFETCH_THRESHOLD of the last loaded item. The explicit "Load more" row
  // below is a keyboard/click fallback for when this hasn't fired yet (e.g.
  // mouse-only navigation that never moves `selectedIndex`).
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || flatResults.length === 0) return;
    if (selectedIndex >= flatResults.length - PREFETCH_THRESHOLD) {
      fetchNextPage();
    }
  }, [selectedIndex, hasNextPage, isFetchingNextPage, flatResults.length, fetchNextPage]);

  const jumpToMessage = useCallback(
    (msg: SearchMessageItem) => {
      addRecentSearch(query);
      close();
      setMainSurface({ kind: "conversation" });
      setSelectedConversationId(msg.conversationId);

      if (msg.rootMessageId) {
        // Thread reply — open the thread panel for the root message, then highlight the reply inside
        openThreadForMessage(msg.rootMessageId);
        setHighlightedMessageId(msg.id);
      } else {
        // Normal message — highlight in the main timeline
        setHighlightedMessageId(msg.id);
      }
    },
    [
      query,
      close,
      addRecentSearch,
      setMainSurface,
      setSelectedConversationId,
      setHighlightedMessageId,
      openThreadForMessage,
    ],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, Math.max(navCount - 1, 0)));
          break;
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          event.preventDefault();
          if (isLoadMoreSelected) {
            if (!isFetchingNextPage) fetchNextPage();
          } else if (flatResults[selectedIndex]) {
            jumpToMessage(flatResults[selectedIndex]);
          }
          break;
        case "Escape":
          event.preventDefault();
          // Tips popover closes first, then the query, then the overlay.
          if (tipsOpen) {
            setTipsOpen(false);
          } else if (query) {
            setQuery("");
          } else {
            close();
          }
          break;
      }
    },
    [
      navCount,
      isLoadMoreSelected,
      isFetchingNextPage,
      fetchNextPage,
      flatResults,
      selectedIndex,
      jumpToMessage,
      tipsOpen,
      query,
      setQuery,
      close,
    ],
  );

  if (!isOpen) return null;

  const hasQuery = query.trim().length > 0;
  const showLoading = hasQuery && isPending;
  const showResults = hasQuery && !isPending && !isError && flatResults.length > 0;
  const showNoResults = hasQuery && !isPending && !isError && data && flatResults.length === 0;
  const showError = hasQuery && isError;
  const showEmpty = !hasQuery;

  // Scope label for display
  const scopeLabel =
    scope.kind === "conversation"
      ? channelNameMap.get(scope.conversationId)
        ? `# ${channelNameMap.get(scope.conversationId)}`
        : "Current channel"
      : "All";

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-[12vh]"
      style={{ zIndex: Z.OVERLAY_CONTENT }}
      onClick={close}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-2xl rounded-xl border border-rim-line bg-rim-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="relative flex items-center gap-2 border-b border-rim-line px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-rim-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — try from:@user, in:#channel, has:link, before:2026-01-01"
            className="flex-1 bg-transparent text-sm text-rim-text outline-none placeholder:text-rim-text-muted"
          />
          <span className="shrink-0 rounded bg-rim-void px-2 py-0.5 text-[10px] text-rim-text-muted">
            {scopeLabel}
          </span>
          <button
            type="button"
            onClick={() => setTipsOpen((v) => !v)}
            className={cn(
              "shrink-0 text-rim-text-muted transition hover:text-rim-text",
              tipsOpen && "text-rim-accent",
            )}
            aria-label="Search tips"
            aria-expanded={tipsOpen}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="shrink-0 text-rim-text-muted transition hover:text-rim-text"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {tipsOpen && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-rim-line bg-rim-panel p-3 shadow-xl">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-rim-text-faint">
                Search operators
              </p>
              <ul className="space-y-1">
                {SEARCH_OPERATORS.map((op) => (
                  <li key={op.operator} className="flex items-baseline gap-2 text-xs">
                    <code className="shrink-0 rounded bg-rim-void px-1.5 py-0.5 text-rim-accent">
                      {op.example}
                    </code>
                    <span className="text-rim-text-muted">{op.meaning}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-rim-text-faint">
                Operators can be combined with each other and with free text.
              </p>
            </div>
          )}
        </div>

        {/* Results area */}
        <div ref={listRef} className="max-h-96 overflow-y-auto p-1">
          {showEmpty && recentSearches.length > 0 && (
            <div className="px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-rim-text-faint">
                Recent
              </p>
              {recentSearches.map((recent) => (
                <button
                  key={recent}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-rim-text-muted transition hover:bg-white/5"
                  onClick={() => setQuery(recent)}
                >
                  <Clock className="h-3 w-3" />
                  {recent}
                </button>
              ))}
            </div>
          )}

          {showEmpty && recentSearches.length === 0 && (
            <div className="flex flex-col items-center py-10 text-center">
              <Search className="mb-2 h-6 w-6 text-rim-text-faint" />
              <p className="text-sm text-rim-text-muted">
                {scope.kind === "conversation"
                  ? `Search messages in ${scopeLabel}`
                  : "Search messages across your workspace"}
              </p>
            </div>
          )}

          {showLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-rim-text-muted" />
            </div>
          )}

          {hasQuery && isOffline && !isPending && (
            <p className="px-3 pb-1 pt-2 text-[10px] text-rim-text-faint">
              Offline: showing matches from messages saved on this device.
            </p>
          )}

          {showResults && (
            <>
              {flatResults.map((msg, idx) => {
                const authorName =
                  msg.author?.displayName || msg.author?.username || msg.authorId.slice(0, 8);
                const type = msg.conversationType;
                const prefix = type === "CHANNEL" ? "# " : type === "DIRECT" ? "@ " : "";
                const convLabel = msg.conversationTitle
                  ? `${prefix}${msg.conversationTitle}`
                  : channelNameMap.get(msg.conversationId)
                    ? `# ${channelNameMap.get(msg.conversationId)}`
                    : msg.conversationId.slice(0, 8);
                return (
                  <button
                    key={msg.id}
                    type="button"
                    data-search-result
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition",
                      selectedIndex === idx ? "bg-rim-accent/10" : "hover:bg-white/5",
                    )}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => jumpToMessage(msg)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium text-rim-text">
                        {authorName}
                      </span>
                      <span className="shrink-0 text-[10px] text-rim-text-faint">
                        {formatRelativeTime(msg.sentAt)}
                      </span>
                    </div>
                    <span className="truncate text-[10px] text-rim-text-faint">{convLabel}</span>
                    <SearchSnippet headline={msg.headline} text={msg.text ?? ""} />
                  </button>
                );
              })}

              {hasNextPage && (
                <button
                  type="button"
                  data-search-result
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs text-rim-text-muted transition hover:bg-white/5 disabled:opacity-50",
                    isLoadMoreSelected && "bg-rim-accent/10",
                  )}
                  onMouseEnter={() => setSelectedIndex(flatResults.length)}
                >
                  {isFetchingNextPage ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Load more"
                  )}
                </button>
              )}
            </>
          )}

          {showNoResults && (
            <div className="flex flex-col items-center py-10 text-center">
              <p className="text-sm text-rim-text-muted">
                No messages matching &ldquo;{query.trim()}&rdquo;
              </p>
            </div>
          )}

          {showError && (
            <div className="flex flex-col items-center py-10 text-center">
              <p className="mb-2 text-sm text-rim-danger">Failed to search messages.</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="text-xs text-rim-accent transition hover:underline"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-rim-line px-4 py-2 flex items-center gap-4 text-[11px] text-rim-text-muted">
          <span>
            <kbd className="font-mono">&#8593;&#8595;</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">Enter</kbd> jump
          </span>
          <span>
            <kbd className="font-mono">Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
