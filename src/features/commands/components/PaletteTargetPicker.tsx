import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { handleDomain, personName } from "../../../shared/utils/handles";
import { cn } from "../../../shared/ui/cn";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useChannels, useJoinedChannels } from "../../conversations/api/useChannels";
import { useInboxConversations } from "../../conversations/api/useInboxConversations";
import type { ConversationSummary } from "../../conversations/types";
import { directPeerId, untitledGroupName } from "../../conversations/utils";
import { useContactStore } from "../../relay/contacts/useContactStore";
import { useDirectInbox } from "../../relay/api/useDirectInbox";
import { isDirectSpace, useIsDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { fetchServerMembers } from "../../workspaces/api/useServerMembers";
import { useKnownHandles } from "../../workspaces/state/useKnownHandles";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { ownerName, workspaceLabels } from "../../workspaces/workspaceLabel";
import type { TargetPickerKind } from "../state/useCommandStore";

/** What the palette can run a command on: a conversation or a workspace. */
export interface PickerTarget {
  id: string;
  /** The workspace the target is in; the target itself for a workspace. */
  serverId: string;
  label: string;
}

interface PickerText {
  title: string;
  placeholder: string;
  empty: string;
}

const TEXT: Record<TargetPickerKind, PickerText> = {
  channel: {
    title: "Go to channel",
    placeholder: "Search channels and messages...",
    empty: "No channels or messages.",
  },
  direct: {
    title: "Go to direct message",
    placeholder: "Search direct messages...",
    empty: "No direct messages.",
  },
  workspace: {
    title: "Switch workspace",
    placeholder: "Search workspaces...",
    empty: "No other workspaces",
  },
  joinableChannel: {
    title: "Join channel",
    placeholder: "Search channels...",
    empty: "No channels to join",
  },
};

interface Targets {
  items: PickerTarget[];
  isPending: boolean;
}

/** The names of the people in `conversations`, as the side rail shows them. */
function useConversationLabels(conversations: readonly ConversationSummary[]) {
  const userId = useAuthStore((s) => s.session?.userId);
  const { data: me } = useCurrentUser();
  const aliases = useContactStore((s) => s.aliases);
  const handles = useKnownHandles((s) => s.byUser);
  const serverIds = useMemo(
    () => [...new Set(conversations.map((c) => c.serverId))].sort(),
    [conversations],
  );
  const members = useQueries({
    queries: serverIds.map((serverId) => ({
      queryKey: queryKeys.serverMembers(serverId),
      queryFn: () => fetchServerMembers(serverId),
      staleTime: 60_000,
      networkMode: "offlineFirst" as const,
    })),
  });

  return useMemo(() => {
    const ownDomain = handleDomain(me?.handle);
    const names = new Map<string, string>();
    for (const { data } of members) {
      for (const member of data ?? []) {
        const alias = member.principalId ? aliases[member.principalId] : undefined;
        names.set(
          member.userId,
          alias ??
            personName({ ...member, handle: handles[member.userId] }, member.userId, ownDomain),
        );
      }
    }
    if (me) names.set(me.id, me.displayName || me.username);
    const nameOf = (id: string) => names.get(id) ?? "Unknown user";
    return (conversation: ConversationSummary): string => {
      if (conversation.conversationType === ConversationTypeEnum.CHANNEL) {
        return `#${conversation.title ?? "channel"}`;
      }
      if (conversation.title) return conversation.title;
      if (conversation.conversationType === ConversationTypeEnum.DIRECT) {
        const peer = directPeerId(conversation, userId);
        return peer ? nameOf(peer) : "Untitled";
      }
      return untitledGroupName(conversation, userId, nameOf) ?? "Untitled";
    };
  }, [members, me, aliases, handles, userId]);
}

/** Names `conversations` for the list. */
function useNamed(conversations: readonly ConversationSummary[]): PickerTarget[] {
  const labelOf = useConversationLabels(conversations);
  return useMemo(
    () => conversations.map((c) => ({ id: c.id, serverId: c.serverId, label: labelOf(c) })),
    [conversations, labelOf],
  );
}

/** The open workspace's channels the viewer is in, and its DMs and groups, as the sidebar lists them. */
function useChannelTargets(): Targets {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  const joined = useJoinedChannels(workspaceId);
  const inbox = useInboxConversations(workspaceId);
  const conversations = useMemo(
    () => [
      ...(joined.data?.items ?? []).filter((c) => !c.isArchived),
      ...(inbox.data?.items ?? []),
    ],
    [joined.data, inbox.data],
  );
  return { items: useNamed(conversations), isPending: joined.isPending || inbox.isPending };
}

/** The DMs and groups of every direct space, as the direct message list shows them. */
function useDirectTargets(): Targets {
  const { items, isPending } = useDirectInbox();
  return { items: useNamed(items), isPending };
}

/** The open workspace's unarchived channels the viewer has not joined, as Browse channels lists them. */
function useJoinableTargets(): Targets {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  const { data, isPending } = useChannels(workspaceId);
  const conversations = useMemo(
    () => (data?.items ?? []).filter((c) => !c.isMember && !c.isArchived),
    [data],
  );
  return { items: useNamed(conversations), isPending };
}

/** The workspaces on the rail other than the open one and the direct space. */
function useWorkspaceTargets(): Targets {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { data: servers, isPending } = useMyServers();
  const remoteSpaces = useRelayStore((s) => s.spaces);
  const origins = useRelayStore((s) => s.origins);
  const forked = useRelayStore((s) => s.forked);

  const items = useMemo(() => {
    const elsewhere = Object.values(remoteSpaces)
      .filter((space) => space.kind === "workspace" && !forked.includes(space.hostServerId))
      .map((space) => ({
        id: space.spaceId,
        name: space.name ?? "Workspace",
        ownerName: space.ownerName,
        origin: origins[space.hostServerId] ?? space.hostServerId,
      }));
    const all = [
      ...(servers ?? []).map((server) => ({
        id: server.id,
        name: server.name,
        ownerName: ownerName(server.owner),
      })),
      ...elsewhere,
    ];
    const labels = workspaceLabels(all);
    return all
      .map((ws, i) => ({ id: ws.id, serverId: ws.id, label: labels[i] }))
      .filter((ws) => ws.id !== workspaceId && !isDirectSpace(ws.id));
  }, [servers, remoteSpaces, origins, forked, workspaceId]);
  return { items, isPending };
}

interface PaletteTargetPickerProps {
  kind: TargetPickerKind;
  /** Called with the target the person chose. */
  onPick: (target: PickerTarget) => void;
  /** Called to return to the command list. */
  onBack: () => void;
}

/**
 * The command palette's second step: a titled, searchable list of the targets a command runs
 * on. Arrow keys move, Enter or a click picks, Escape returns to the command list.
 */
export function PaletteTargetPicker(props: PaletteTargetPickerProps) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const inDirectSpace = useIsDirectSpace(workspaceId);
  // A direct space has no channels: its conversations are the direct messages.
  const source = props.kind === "channel" && inDirectSpace ? "direct" : props.kind;
  switch (source) {
    case "channel":
      return <TargetList key={source} {...props} useTargets={useChannelTargets} />;
    case "direct":
      return <TargetList key={source} {...props} useTargets={useDirectTargets} />;
    case "workspace":
      return <TargetList key={source} {...props} useTargets={useWorkspaceTargets} />;
    case "joinableChannel":
      return <TargetList key={source} {...props} useTargets={useJoinableTargets} />;
  }
}

function TargetList({
  kind,
  onPick,
  onBack,
  useTargets,
}: PaletteTargetPickerProps & { useTargets: () => Targets }) {
  const text = TEXT[kind];
  const { items, isPending } = useTargets();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((t) => t.label.toLowerCase().includes(needle)) : items;
  }, [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const row = listRef.current?.querySelectorAll("[data-target-item]")[selectedIndex];
    (row as HTMLElement | undefined)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  function handleKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, shown.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        event.preventDefault();
        if (shown[selectedIndex]) onPick(shown[selectedIndex]);
        break;
      case "Escape":
        event.preventDefault();
        onBack();
        break;
      default:
        return;
    }
    event.stopPropagation();
  }

  return (
    <div onKeyDown={handleKeyDown}>
      <div className="border-b border-rim-line px-4 pt-3 text-xs font-medium text-rim-text-muted">
        {text.title}
      </div>
      <div className="flex items-center gap-2 border-b border-rim-line px-4 py-3">
        <Search className="h-4 w-4 text-rim-text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={text.placeholder}
          aria-label={text.title}
          className="flex-1 bg-transparent text-sm text-rim-text outline-none placeholder:text-rim-text-muted"
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={text.title}
        className="max-h-80 overflow-y-auto p-1"
      >
        {isPending ? (
          <div className="px-4 py-8 text-center text-sm text-rim-text-muted">Loading...</div>
        ) : shown.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-rim-text-muted">
            {items.length === 0 ? text.empty : "No matches."}
          </div>
        ) : (
          shown.map((target, index) => (
            <button
              key={`${target.serverId}:${target.id}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              data-target-item
              className={cn(
                "flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors",
                index === selectedIndex
                  ? "bg-rim-accent/10 text-rim-text"
                  : "text-rim-text-muted hover:bg-rim-void/50",
              )}
              onClick={() => onPick(target)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="truncate">{target.label}</span>
            </button>
          ))
        )}
      </div>
      <div className="flex items-center gap-4 border-t border-rim-line px-4 py-2 text-[11px] text-rim-text-muted">
        <span>
          <kbd className="font-mono">&#8593;&#8595;</kbd> navigate
        </span>
        <span>
          <kbd className="font-mono">Enter</kbd> select
        </span>
        <span>
          <kbd className="font-mono">Esc</kbd> back
        </span>
      </div>
    </div>
  );
}
