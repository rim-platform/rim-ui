import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Users, Check, X } from "lucide-react";
import { useFuzzySearchList, Highlight } from "@nozbe/microfuzz/react";

import { Z } from "../../../shared/ui/zIndex";
import { cn } from "../../../shared/ui/cn";
import { useCreateConversationMutation } from "../api/useCreateConversation";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { usePresenceStore } from "../../presence/state/usePresenceStore";
import { detectOs } from "../../../core/runtime/runtime";

interface NewMessagePickerProps {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

export function NewMessagePicker({ open, onClose, onCreated }: NewMessagePickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setFocusedSurface = useShellStore((s) => s.setFocusedSurface);
  const memberLookup = useMemberLookup(workspaceId ?? undefined);
  const createMutation = useCreateConversationMutation();

  const { data: me } = useCurrentUser();
  const { data: members, isPending: membersPending } = useServerMembers(workspaceId ?? undefined);

  // Pre-compute resolved members: sorted once, display names resolved.
  // Only recomputes when members or me change — NOT on every keystroke.
  const resolvedMembers = useMemo(() => {
    const otherMembers = (members ?? []).filter((m) => m.userId !== me?.id);
    return otherMembers
      .map((m) => {
        const displayName = memberLookup.resolve(m.userId).displayName;
        return {
          userId: m.userId,
          username: m.username,
          displayName,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [members, me?.id, memberLookup.map]); // depend on map reference, not memberLookup object

  const getText = useCallback(
    (member: { displayName: string; username: string }) => [member.displayName, member.username],
    [],
  );

  const mapResultItem = useCallback(
    (result: {
      item: (typeof resolvedMembers)[number];
      score: number;
      matches: Array<Array<[number, number]> | null>;
    }) => result,
    [],
  );

  // Fuzzy-filter resolved members by search query via microfuzz.
  const filteredResults = useFuzzySearchList({
    list: resolvedMembers,
    queryText: searchQuery,
    getText,
    mapResultItem,
  });

  // Reset focused index when query changes
  useEffect(() => {
    setFocusedIndex(0);
  }, [searchQuery]);

  // Focus input when picker opens
  useEffect(() => {
    if (open) {
      setFocusedSurface("newMessagePicker");
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setFocusedSurface(null);
    }
  }, [open, setFocusedSurface]);

  // Reset state when picker closes
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setSelectedUserIds([]);
      setFocusedIndex(0);
    }
  }, [open]);

  // Scroll focused item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-member-item]");
    if (items[focusedIndex]) {
      (items[focusedIndex] as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  function toggleMember(userId: string) {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }

  const handleConfirm = useCallback(() => {
    if (!workspaceId || selectedUserIds.length === 0) return;

    if (selectedUserIds.length === 1) {
      createMutation.mutate(
        {
          serverId: workspaceId,
          otherUserId: selectedUserIds[0],
        },
        {
          onSuccess: (data) => {
            onCreated(data.createConversation.id);
          },
        },
      );
    } else {
      createMutation.mutate(
        {
          serverId: workspaceId,
          memberIds: selectedUserIds,
        },
        {
          onSuccess: (data) => {
            onCreated(data.createConversation.id);
          },
        },
      );
    }
  }, [workspaceId, selectedUserIds, createMutation, onCreated]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, filteredResults.length - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          event.preventDefault();
          if ((event.metaKey || event.ctrlKey) && selectedUserIds.length > 0) {
            handleConfirm();
          } else if (searchQuery === "" && selectedUserIds.length > 0) {
            handleConfirm();
          } else if (filteredResults[focusedIndex]) {
            toggleMember(filteredResults[focusedIndex].item.userId);
          }
          break;
        case "Backspace":
          if (searchQuery === "" && selectedUserIds.length > 0) {
            setSelectedUserIds((prev) => prev.slice(0, -1));
          }
          break;
        case "Escape":
          event.preventDefault();
          onClose();
          break;
      }
    },
    [filteredResults, focusedIndex, searchQuery, selectedUserIds, handleConfirm, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-[12vh]"
      style={{ zIndex: Z.OVERLAY_CONTENT }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg rounded-xl border border-rim-line bg-rim-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Input row with pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-rim-line px-4 py-3">
          <Users className="h-4 w-4 shrink-0 text-rim-text-muted" />
          {selectedUserIds.map((id) => {
            const resolved = resolvedMembers.find((m) => m.userId === id);
            return (
              <span
                key={id}
                className="flex items-center gap-1 rounded-full bg-rim-accent/15 px-2 py-0.5 text-xs text-rim-accent"
              >
                {resolved?.displayName ?? id.slice(0, 8)}
                <button
                  type="button"
                  onClick={() => toggleMember(id)}
                  className="rounded-full p-0.5 transition hover:bg-rim-accent/20"
                  aria-label="Remove member"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={selectedUserIds.length === 0 ? "Search members..." : "Add more..."}
            className="min-w-[120px] flex-1 bg-transparent text-sm text-rim-text outline-none placeholder:text-rim-text-muted"
          />
        </div>

        {/* Member list */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {membersPending && (
            <div className="px-4 py-8 text-center text-sm text-rim-text-muted">
              Loading members...
            </div>
          )}
          {!membersPending && filteredResults.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-rim-text-muted">
              No members found.
            </div>
          )}
          {filteredResults.map((result, index) => {
            const member = result.item;
            const selected = selectedUserIds.includes(member.userId);
            return (
              <button
                key={member.userId}
                data-member-item
                type="button"
                onClick={() => toggleMember(member.userId)}
                onMouseEnter={() => setFocusedIndex(index)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  index === focusedIndex
                    ? "bg-rim-accent/10 text-rim-text"
                    : "text-rim-text-muted hover:bg-rim-void/50",
                )}
              >
                <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-medium uppercase text-rim-text">
                  {member.displayName.charAt(0)}
                  <PresenceDot userId={member.userId} />
                </span>
                <span className="flex-1 truncate">
                  <Highlight text={member.displayName} ranges={result.matches?.[0] ?? null} />
                </span>
                {selected ? (
                  <Check className="ml-auto h-4 w-4 shrink-0 text-rim-accent" />
                ) : (
                  <span className="ml-auto text-xs text-rim-text-faint truncate max-w-[120px]">
                    {member.username}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Error */}
        {createMutation.error && (
          <div className="border-t border-rim-line px-4 py-2">
            <p className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : "Failed to create conversation"}
            </p>
          </div>
        )}

        {/* Footer */}
        <NewMessagePickerFooter selectedCount={selectedUserIds.length} />
      </div>
    </div>
  );
}

function PresenceDot({ userId }: { userId: string }) {
  const status = usePresenceStore((s) => s.presenceMap[userId]);
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-rim-panel",
        status === "ONLINE" && "bg-rim-success",
        status === "AWAY" && "bg-rim-warm",
        (!status || status === "OFFLINE") && "bg-rim-text-faint",
      )}
    />
  );
}

function NewMessagePickerFooter({ selectedCount }: { selectedCount: number }) {
  const isMac = detectOs() === "macos";
  const confirmHint = isMac ? "\u2318\u21A9" : "Ctrl+\u21A9";

  return (
    <div className="border-t border-rim-line px-4 py-2 flex items-center gap-4 text-[11px] text-rim-text-muted">
      <span>
        <kbd className="font-mono">&#8593;&#8595;</kbd> navigate
      </span>
      <span>
        <kbd className="font-mono">Enter</kbd> select
      </span>
      {selectedCount > 0 && (
        <span>
          <kbd className="font-mono">{confirmHint}</kbd>{" "}
          {selectedCount === 1 ? "open DM" : "create group"}
        </span>
      )}
      <span className="ml-auto">
        <kbd className="font-mono">Esc</kbd> close
      </span>
    </div>
  );
}
