import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Users, Check, X } from "lucide-react";
import { useFuzzySearchList, Highlight } from "@nozbe/microfuzz/react";

import { cn } from "../../../shared/ui/cn";
import { Avatar } from "../../../shared/ui/Avatar";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { usePresenceStore } from "../../presence/state/usePresenceStore";

export interface MemberPickerProps {
  workspaceId: string | undefined;
  selectedUserIds: string[];
  onChange: (userIds: string[]) => void;
  /** Workspace members that cannot be picked (e.g. already in the conversation). */
  excludeUserIds?: readonly string[];
  /** Ctrl/Cmd+Enter, or Enter with an empty query and at least one pick. */
  onConfirm?: () => void;
  /** Escape. When absent, Escape bubbles (so an enclosing dialog can close). */
  onEscape?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  listClassName?: string;
}

/**
 * Fuzzy multi-select over the workspace's members (the viewer is never offered). Shared by the
 * new-message picker, the create-channel dialog and the conversation members panel.
 */
export function MemberPicker({
  workspaceId,
  selectedUserIds,
  onChange,
  excludeUserIds,
  onConfirm,
  onEscape,
  autoFocus = false,
  placeholder = "Search members...",
  listClassName = "max-h-80",
}: MemberPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const memberLookup = useMemberLookup(workspaceId);
  const { data: me } = useCurrentUser();
  const { data: members, isPending: membersPending } = useServerMembers(workspaceId);

  // Sorted once with display names resolved; only recomputes when the member list changes,
  // not on every keystroke.
  const resolvedMembers = useMemo(() => {
    const excluded = new Set(excludeUserIds ?? []);
    return (members ?? [])
      .filter((m) => m.userId !== me?.id && !excluded.has(m.userId))
      .map((m) => {
        const resolved = memberLookup.resolve(m.userId);
        return {
          userId: m.userId,
          handle: resolved.handleView?.shown ?? "",
          displayName: resolved.displayName,
          avatarUrl: resolved.avatarUrl ?? null,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [members, me?.id, memberLookup, excludeUserIds]);

  const getText = useCallback(
    (member: { displayName: string; handle: string }) => [member.displayName, member.handle],
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

  const filteredResults = useFuzzySearchList({
    list: resolvedMembers,
    queryText: searchQuery,
    getText,
    mapResultItem,
  });

  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  // Scroll the focused row into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-member-item]");
    const item = items[focusedIndex];
    if (item instanceof HTMLElement && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  function toggleMember(userId: string) {
    onChange(
      selectedUserIds.includes(userId)
        ? selectedUserIds.filter((id) => id !== userId)
        : [...selectedUserIds, userId],
    );
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, filteredResults.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter": {
        // Always swallow Enter so a picker inside a <form> never submits it.
        event.preventDefault();
        const wantsConfirm =
          (event.metaKey || event.ctrlKey || searchQuery === "") && selectedUserIds.length > 0;
        if (wantsConfirm && onConfirm) {
          onConfirm();
        } else if (filteredResults[focusedIndex]) {
          toggleMember(filteredResults[focusedIndex].item.userId);
        }
        break;
      }
      case "Backspace":
        if (searchQuery === "" && selectedUserIds.length > 0) {
          onChange(selectedUserIds.slice(0, -1));
        }
        break;
      case "Escape":
        if (onEscape) {
          event.preventDefault();
          onEscape();
        }
        break;
    }
  }

  return (
    <div onKeyDown={handleKeyDown}>
      {/* Input row with pills */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-rim-line px-4 py-3">
        <Users className="h-4 w-4 shrink-0 text-rim-text-muted" />
        {selectedUserIds.map((id) => {
          const name = memberLookup.resolve(id).displayName;
          return (
            <span
              key={id}
              className="flex items-center gap-1 rounded-full bg-rim-accent/15 px-2 py-0.5 text-xs text-rim-accent"
            >
              {name}
              <button
                type="button"
                onClick={() => toggleMember(id)}
                className="rounded-full p-0.5 transition hover:bg-rim-accent/20"
                aria-label={`Remove ${name}`}
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
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setFocusedIndex(0);
          }}
          placeholder={selectedUserIds.length === 0 ? placeholder : "Add more..."}
          aria-label="Search members"
          className="min-w-[120px] flex-1 bg-transparent text-sm text-rim-text outline-none placeholder:text-rim-text-muted"
        />
      </div>

      {/* Member list */}
      <div
        ref={listRef}
        role="listbox"
        aria-multiselectable
        className={cn("overflow-y-auto p-1", listClassName)}
      >
        {membersPending && (
          <div className="px-4 py-8 text-center text-sm text-rim-text-muted">
            Loading members...
          </div>
        )}
        {!membersPending && filteredResults.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-rim-text-muted">No members found.</div>
        )}
        {filteredResults.map((result, index) => {
          const member = result.item;
          const selected = selectedUserIds.includes(member.userId);
          return (
            <button
              key={member.userId}
              data-member-item
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => toggleMember(member.userId)}
              onMouseEnter={() => setFocusedIndex(index)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                index === focusedIndex
                  ? "bg-rim-accent/10 text-rim-text"
                  : "text-rim-text-muted hover:bg-rim-void/50",
              )}
            >
              <MemberAvatar
                userId={member.userId}
                name={member.displayName}
                avatarUrl={member.avatarUrl}
              />
              <span className="flex-1 truncate">
                <Highlight text={member.displayName} ranges={result.matches?.[0] ?? null} />
              </span>
              {selected ? (
                <Check className="ml-auto h-4 w-4 shrink-0 text-rim-accent" />
              ) : (
                <span className="ml-auto max-w-[120px] truncate text-xs text-rim-text-faint">
                  {member.handle}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MemberAvatar({
  userId,
  name,
  avatarUrl,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
}) {
  const status = usePresenceStore((s) => s.presenceMap[userId]);
  return (
    <Avatar
      url={avatarUrl}
      name={name}
      userId={userId}
      size="md"
      presenceStatus={status === "ONLINE" || status === "AWAY" ? status : "OFFLINE"}
    />
  );
}
