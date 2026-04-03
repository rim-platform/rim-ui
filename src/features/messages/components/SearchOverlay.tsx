import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, Loader2, X, Clock } from "lucide-react";

import { Z } from "../../../shared/ui/zIndex";
import { cn } from "../../../shared/ui/cn";
import { useSearchOverlayStore } from "../state/useSearchOverlayStore";
import { useSearchMessages, type SearchMessageItem } from "../api/useSearchMessages";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useChannels } from "../../conversations/api/useChannels";

function formatRelativeTime(sentAt: string): string {
  const now = Date.now();
  const then = new Date(sentAt).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(sentAt).toLocaleDateString();
}

interface ResultGroup {
  conversationId: string;
  label: string;
  items: SearchMessageItem[];
}

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

  const conversationId = scope.kind === "conversation" ? scope.conversationId : undefined;
  const { data: results, isPending, isError, refetch } = useSearchMessages(
    workspaceId ?? undefined,
    conversationId,
    query,
  );

  const [selectedIndex, setSelectedIndex] = useState(0);
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

  // Group results by conversation
  const groups = useMemo<ResultGroup[]>(() => {
    if (!results || results.length === 0) return [];
    const groupMap = new Map<string, SearchMessageItem[]>();
    for (const item of results) {
      const existing = groupMap.get(item.conversationId);
      if (existing) {
        existing.push(item);
      } else {
        groupMap.set(item.conversationId, [item]);
      }
    }
    return Array.from(groupMap.entries()).map(([convId, items]) => {
      // Use conversationTitle from search results (backend provides it)
      const firstItem = items[0];
      const title = firstItem.conversationTitle;
      const type = firstItem.conversationType;
      const prefix = type === "CHANNEL" ? "# " : type === "DIRECT" ? "@ " : "";
      const label = title
        ? `${prefix}${title}`
        : channelNameMap.get(convId)
          ? `# ${channelNameMap.get(convId)}`
          : convId.slice(0, 8);
      return { conversationId: convId, label, items };
    });
  }, [results, channelNameMap]);

  // Flat list for keyboard navigation
  const flatResults = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Reset selection on results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Scroll selected into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-search-result]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

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
    [query, close, addRecentSearch, setMainSurface, setSelectedConversationId, setHighlightedMessageId, openThreadForMessage],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Tab": {
          // Tab to next group
          event.preventDefault();
          let current = 0;
          for (const group of groups) {
            if (selectedIndex < current + group.items.length) {
              setSelectedIndex(Math.min(current + group.items.length, flatResults.length - 1));
              return;
            }
            current += group.items.length;
          }
          break;
        }
        case "Enter":
          event.preventDefault();
          if (flatResults[selectedIndex]) {
            jumpToMessage(flatResults[selectedIndex]);
          }
          break;
        case "Escape":
          event.preventDefault();
          if (query) {
            setQuery("");
          } else {
            close();
          }
          break;
      }
    },
    [flatResults, selectedIndex, groups, query, setQuery, close, jumpToMessage],
  );

  if (!isOpen) return null;

  const hasQuery = query.trim().length > 0;
  const showLoading = hasQuery && isPending;
  const showResults = hasQuery && !isPending && !isError && flatResults.length > 0;
  const showNoResults = hasQuery && !isPending && !isError && results && results.length === 0;
  const showError = hasQuery && isError;
  const showEmpty = !hasQuery;

  // Scope label for display
  const scopeLabel = scope.kind === "conversation"
    ? channelNameMap.get(scope.conversationId)
      ? `# ${channelNameMap.get(scope.conversationId)}`
      : "Current channel"
    : "All";

  let flatIndex = 0;

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
        <div className="flex items-center gap-2 border-b border-rim-line px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-rim-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages..."
            className="flex-1 bg-transparent text-sm text-rim-text outline-none placeholder:text-rim-text-muted"
          />
          <span className="shrink-0 rounded bg-rim-void px-2 py-0.5 text-[10px] text-rim-text-muted">
            {scopeLabel}
          </span>
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-rim-text-muted transition hover:text-rim-text"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Results area */}
        <div ref={listRef} className="max-h-96 overflow-y-auto p-1">
          {showEmpty && recentSearches.length > 0 && (
            <div className="px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-rim-text-faint">Recent</p>
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

          {showResults && groups.map((group) => {
            const groupStartIndex = flatIndex;
            const groupEl = (
              <div key={group.conversationId}>
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-rim-text-faint">
                  {group.label} — {group.items.length} hit{group.items.length !== 1 ? "s" : ""}
                </div>
                {group.items.map((msg) => {
                  const idx = flatIndex++;
                  const authorName = msg.author?.displayName || msg.author?.username || msg.authorId.slice(0, 8);
                  return (
                    <button
                      key={msg.id}
                      type="button"
                      data-search-result
                      className={cn(
                        "flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition",
                        selectedIndex === idx
                          ? "bg-rim-accent/10"
                          : "hover:bg-white/5",
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
                      <HighlightedText text={msg.text ?? ""} query={query} />
                    </button>
                  );
                })}
              </div>
            );
            // Ensure flatIndex is updated even if we skip rendering
            if (flatIndex === groupStartIndex) {
              flatIndex += group.items.length;
            }
            return groupEl;
          })}

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
          <span><kbd className="font-mono">&#8593;&#8595;</kbd> navigate</span>
          <span><kbd className="font-mono">Tab</kbd> next group</span>
          <span><kbd className="font-mono">Enter</kbd> jump</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) {
    return <p className="text-xs leading-relaxed text-rim-text-muted line-clamp-2">{text}</p>;
  }

  const parts: { text: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  const qLower = query.trim().toLowerCase();
  let lastIndex = 0;

  let pos = lower.indexOf(qLower);
  while (pos !== -1) {
    if (pos > lastIndex) {
      parts.push({ text: text.slice(lastIndex, pos), match: false });
    }
    parts.push({ text: text.slice(pos, pos + qLower.length), match: true });
    lastIndex = pos + qLower.length;
    pos = lower.indexOf(qLower, lastIndex);
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), match: false });
  }

  return (
    <p className="text-xs leading-relaxed text-rim-text-muted line-clamp-2">
      {parts.map((part, i) =>
        part.match ? (
          <span key={i} className="rounded-sm bg-rim-accent/20 text-rim-accent">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}
