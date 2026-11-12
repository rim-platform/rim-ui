import { useId, useMemo, useState, type ReactNode, type RefObject } from "react";
import { useQueries } from "@tanstack/react-query";
import { Hash, MessageSquare, Search, Terminal } from "lucide-react";
import { Highlight } from "@nozbe/microfuzz/react";

import { cn } from "../../../shared/ui/cn";
import { formatRelativeTime } from "../../../shared/utils/formatTime";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { joinedChannelsQueryOptions } from "../../conversations/api/useChannels";
import { useOpenConversation } from "../../conversations/hooks/useOpenConversation";
import { currentCacheAccount } from "../../messages/api/messageCache";
import { useMessageSearchResults } from "../../messages/api/useMessageSearchResults";
import type { SearchMessageItem } from "../../messages/api/useSearchMessages";
import {
  ACROSS_MIN_LENGTH,
  searchOrder,
  useMessagesAcrossWorkspaces,
} from "../../messages/api/searchAcrossWorkspaces";
import { SearchSnippet } from "../../messages/components/SearchSnippet";
import { openSearchResult } from "../../messages/runtime/openSearchResult";
import { useSearchOverlayStore } from "../../messages/state/useSearchOverlayStore";
import { useDirectSpaceIds } from "../../relay/api/useDirectInbox";
import { isDirectSpace, useIsDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { useWorkspaceName } from "../../workspaces/hooks/useWorkspaceName";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import type { ConversationSummary } from "../../conversations/types";
import type { PaletteMatch } from "../runtime/paletteSearch";
import type { CommandDefinition } from "../types";
import { useCommandStore, type SearchBoxScope } from "../state/useCommandStore";
import {
  useChannelTargets,
  useDirectTargets,
  useNamed,
  useWorkspaceTargets,
  type PickerTarget,
} from "./paletteTargets";

/** The most rows each group shows. */
const GROUP_LIMIT = 5;

/** A conversation, a person's DM or a workspace the box can open. */
interface PlaceRow extends PickerTarget {
  kind: "conversation" | "workspace";
  /** Where it is, shown beside it when the box searches every workspace. */
  detail: string | null;
}

/** One row of the box, in the order the arrow keys walk them. */
type Row =
  | { group: "places"; key: string; place: PlaceRow }
  | { group: "messages"; key: string; message: SearchMessageItem }
  | { group: "commands"; key: string; match: PaletteMatch<CommandDefinition> };

const GROUP_TITLES: Record<Row["group"], string> = {
  places: "Channels and people",
  messages: "Messages",
  commands: "Commands",
};

/** The unarchived channels of joined-channel query results, in one list. */
function unarchivedChannels(
  results: { data?: { items: ConversationSummary[] } }[],
): ConversationSummary[] {
  return results.flatMap(({ data }) => (data?.items ?? []).filter((c) => !c.isArchived));
}

/**
 * The spaces searched in the all-workspaces scope, in rail order: the direct spaces of Direct
 * messages, then the workspaces of this server and those of other servers.
 */
function useRailSpaces(): string[] {
  const { data: servers } = useMyServers();
  const spaces = useRelayStore((s) => s.spaces);
  const forked = useRelayStore((s) => s.forked);
  const directSpaceIds = useDirectSpaceIds();
  return useMemo(() => {
    const remote = Object.values(spaces)
      .filter((space) => space.kind === "workspace" && !forked.includes(space.hostServerId))
      .map((space) => space.spaceId);
    return [...new Set([...directSpaceIds, ...(servers ?? []).map((s) => s.id), ...remote])];
  }, [servers, spaces, forked, directSpaceIds]);
}

/** The names of the workspaces on the rail, by id, shown beside rows from every workspace. */
function useWorkspaceNames(): Map<string, string> {
  const { data: servers } = useMyServers();
  const spaces = useRelayStore((s) => s.spaces);
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const space of Object.values(spaces)) {
      if (space.kind === "workspace" && space.name) names.set(space.spaceId, space.name);
    }
    for (const server of servers ?? []) names.set(server.id, server.name);
    return names;
  }, [servers, spaces]);
}

/**
 * The channels and people matching `query`: the conversations of the open workspace (or the
 * direct messages in the direct space), and across every workspace also the channels joined
 * elsewhere, the direct messages and the workspaces themselves. They come from the lists the
 * app already holds for the conversation list and the palette's pickers.
 */
function usePlaceRows(query: string, scope: SearchBoxScope): PlaceRow[] {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const inDirectSpace = useIsDirectSpace(workspaceId);
  const channels = useChannelTargets();
  const direct = useDirectTargets();
  const workspaces = useWorkspaceTargets();
  const names = useWorkspaceNames();
  const { data: servers } = useMyServers();
  const everything = scope === "everything";

  const elsewhereChannels = useQueries({
    queries: (everything ? (servers ?? []) : [])
      .filter((server) => server.id !== workspaceId && !isDirectSpace(server.id))
      .map((server) => joinedChannelsQueryOptions(server.id)),
    combine: unarchivedChannels,
  });
  const elsewhereNamed = useNamed(elsewhereChannels);

  return useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const where = (serverId: string) =>
      everything ? showInvisibleCharacters(names.get(serverId) ?? "") || null : null;
    const conversation = (target: PickerTarget, detail: string | null): PlaceRow => ({
      ...target,
      kind: "conversation",
      detail,
    });
    const here = inDirectSpace ? direct.items : channels.items;
    const rows: PlaceRow[] = [
      ...here.map((t) => conversation(t, inDirectSpace ? null : where(t.serverId))),
      ...(everything
        ? [
            ...elsewhereNamed.map((t) => conversation(t, where(t.serverId))),
            ...(inDirectSpace ? [] : direct.items.map((t) => conversation(t, "Direct message"))),
            ...workspaces.items.map((t): PlaceRow => ({
              ...t,
              kind: "workspace",
              detail: "Workspace",
            })),
          ]
        : []),
    ];
    const seen = new Set<string>();
    return rows
      .filter((row) => {
        const key = `${row.kind}:${row.serverId}:${row.id}`;
        if (seen.has(key) || !row.label.toLowerCase().includes(needle)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, GROUP_LIMIT);
  }, [
    query,
    everything,
    inDirectSpace,
    channels.items,
    direct.items,
    workspaces.items,
    elsewhereNamed,
    names,
  ]);
}

/**
 * The newest messages matching `query`: in the open workspace, the overlay's own search with
 * this device's local matches added in the desktop app; across every workspace, one first page
 * from each, newest first.
 */
function useMessageRows(query: string, scope: SearchBoxScope) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const everything = scope === "everything";
  const here = useMessageSearchResults(
    everything ? undefined : (workspaceId ?? undefined),
    undefined,
    query,
  );
  const railSpaces = useRailSpaces();
  const ordered = useMemo(() => searchOrder(railSpaces, workspaceId), [railSpaces, workspaceId]);
  const across = useMessagesAcrossWorkspaces(query, ordered, everything);
  const names = useWorkspaceNames();
  const directSpaceIds = useDirectSpaceIds();

  if (!everything) {
    return {
      items: here.results.slice(0, GROUP_LIMIT),
      isPending: Boolean(query.trim()) && here.isPending,
      notes: here.isOffline
        ? ["Offline: showing matches from messages saved on this device."]
        : [encryptedNote(scope)],
    };
  }
  const nameOf = (id: string) =>
    directSpaceIds.includes(id)
      ? "your direct messages"
      : showInvisibleCharacters(names.get(id) ?? "a workspace");
  return {
    items: across.items,
    isPending: across.isPending,
    notes: [
      ...(across.tooShort
        ? [`Type at least ${ACROSS_MIN_LENGTH} characters to search messages in every workspace.`]
        : []),
      ...(across.searchedCount > 0 && across.searchedCount < across.total
        ? [
            `Searched ${across.searchedCount} of your ${across.total} workspaces. Pick one to search the rest.`,
          ]
        : []),
      ...across.failed.map((id) => `Couldn't search ${nameOf(id)}.`),
      encryptedNote(scope),
    ],
  };
}

/** What the box can say about encrypted messages here, in its own words. */
function encryptedNote(scope: SearchBoxScope): string {
  if (!currentCacheAccount()) return "Encrypted messages can't be searched in the web app.";
  return scope === "everything"
    ? "Encrypted messages are searched one workspace at a time."
    : "Encrypted messages: only those saved on this device.";
}

interface SearchBoxProps {
  /** The search box's text field, which the palette focuses when the box opens. */
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  /** Called with the text as typed; a leading `>` switches the box to commands. */
  onQueryChange: (value: string) => void;
  /** The palette's commands matching the text, best first. */
  commands: PaletteMatch<CommandDefinition>[];
  onRunCommand: (command: CommandDefinition) => void;
  onClose: () => void;
}

/**
 * The search box with search first: what matches the text in three groups, channels and
 * people, messages, then commands, with the scope as a chip that Tab widens to every workspace.
 * The arrow keys move through every row, Enter opens one, and Search all messages opens the
 * full search with the text.
 */
export function SearchBox({
  inputRef,
  query,
  onQueryChange,
  commands,
  onRunCommand,
  onClose,
}: SearchBoxProps) {
  const id = useId();
  const scope = useCommandStore((s) => s.scope);
  const setScope = useCommandStore((s) => s.setScope);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const inDirectSpace = useIsDirectSpace(workspaceId);
  const workspaceName = useWorkspaceName(workspaceId);
  const memberLookup = useMemberLookup(workspaceId ?? undefined);
  const openConversation = useOpenConversation();

  const places = usePlaceRows(query, scope);
  const messages = useMessageRows(query, scope);
  const hasQuery = query.trim().length > 0;

  const rows = useMemo<Row[]>(
    () => [
      ...places.map((place): Row => ({
        group: "places",
        key: `p:${place.kind}:${place.serverId}:${place.id}`,
        place,
      })),
      ...messages.items.map((message): Row => ({
        group: "messages",
        key: `m:${message.id}`,
        message,
      })),
      ...(hasQuery ? commands.slice(0, GROUP_LIMIT) : []).map((match): Row => ({
        group: "commands",
        key: `c:${match.item.id}`,
        match,
      })),
    ],
    [places, messages.items, commands, hasQuery],
  );

  const [selected, setSelected] = useState(0);
  // A new text or scope starts again at the first row, set while rendering.
  const [selectionFor, setSelectionFor] = useState(`${scope}:${query}`);
  if (selectionFor !== `${scope}:${query}`) {
    setSelectionFor(`${scope}:${query}`);
    setSelected(0);
  }
  const active = Math.min(selected, rows.length - 1);
  const rowId = (index: number) => `${id}-row-${index}`;

  const scopeLabel =
    scope === "everything"
      ? "All workspaces"
      : inDirectSpace
        ? "Direct messages"
        : showInvisibleCharacters(workspaceName ?? "This workspace");
  const toggleScope = () => setScope(scope === "everything" ? "workspace" : "everything");

  function open(row: Row) {
    if (row.group === "commands") {
      onRunCommand(row.match.item);
      return;
    }
    onClose();
    if (row.group === "messages") {
      openSearchResult(row.message);
    } else if (row.place.kind === "workspace") {
      useWorkspaceStore.getState().setWorkspaceId(row.place.id);
      useShellStore.getState().setMainSurface({ kind: "conversation" });
    } else {
      openConversation(row.place.id, row.place.serverId);
    }
  }

  function searchAllMessages() {
    onClose();
    useSearchOverlayStore.getState().openWithScope({ kind: "all" }, query.trim());
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        setSelected(Math.min(active + 1, rows.length - 1));
        break;
      case "ArrowUp":
        setSelected(Math.max(active - 1, 0));
        break;
      case "Enter":
        if (rows[active]) open(rows[active]);
        break;
      case "Tab":
        toggleScope();
        break;
      case "Escape":
        onClose();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  const groups = (["places", "messages", "commands"] as const).map((group) => ({
    group,
    rows: rows.map((row, index) => ({ row, index })).filter(({ row }) => row.group === group),
  }));

  return (
    <div onKeyDown={handleKeyDown}>
      <div className="flex items-center gap-2 border-b border-rim-line px-4 py-3">
        <Search aria-hidden className="h-4 w-4 shrink-0 text-rim-text-muted" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search or run a command"
          aria-expanded={hasQuery}
          aria-controls={`${id}-results`}
          aria-autocomplete="list"
          aria-activedescendant={rows[active] ? rowId(active) : undefined}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search, or type > for commands"
          className="min-w-0 flex-1 bg-transparent text-sm text-rim-text outline-none placeholder:text-rim-text-muted"
        />
        <button
          type="button"
          onClick={toggleScope}
          aria-label={`Searching ${scopeLabel}. Switch scope`}
          className="max-w-40 shrink-0 truncate rounded-md bg-rim-accent/15 px-2 py-0.5 text-xs text-rim-accent transition hover:bg-rim-accent/25"
        >
          {scopeLabel}
        </button>
      </div>

      <div
        id={`${id}-results`}
        role="listbox"
        aria-label="Results"
        className="max-h-[min(60vh,28rem)] overflow-y-auto p-1"
      >
        {!hasQuery ? (
          <p className="px-4 py-6 text-center text-sm text-rim-text-muted">
            Type to search {scopeLabel === "All workspaces" ? "every workspace" : scopeLabel}, or{" "}
            <kbd className="font-mono">&gt;</kbd> for commands.
          </p>
        ) : (
          groups.map(({ group, rows: groupRows }) => (
            <Group
              key={group}
              id={`${id}-${group}`}
              title={GROUP_TITLES[group]}
              notes={group === "messages" ? messages.notes : []}
              empty={
                group === "messages" && messages.isPending
                  ? "Searching…"
                  : groupRows.length === 0
                    ? group === "messages"
                      ? "No messages."
                      : group === "places"
                        ? "No channels or people."
                        : "No commands."
                    : null
              }
            >
              {groupRows.map(({ row, index }) => (
                <div
                  key={row.key}
                  id={rowId(index)}
                  role="option"
                  aria-selected={index === active}
                  onClick={() => open(row)}
                  onMouseEnter={() => setSelected(index)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm",
                    index === active ? "bg-rim-accent/10 text-rim-text" : "text-rim-text-muted",
                  )}
                >
                  <RowContent
                    row={row}
                    nameOf={(uid) => memberLookup.resolve(uid).displayName || undefined}
                  />
                </div>
              ))}
            </Group>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rim-line px-4 py-2 text-[11px] text-rim-text-muted">
        <span>
          <kbd className="font-mono">Enter</kbd> open
        </span>
        <span>
          <kbd className="font-mono">Tab</kbd>{" "}
          {scope === "everything" ? "this workspace" : "all workspaces"}
        </span>
        <span>
          <kbd className="font-mono">&gt;</kbd> commands only
        </span>
        <button
          type="button"
          onClick={searchAllMessages}
          className="ml-auto text-rim-accent hover:underline"
        >
          Search all messages
        </button>
      </div>
    </div>
  );
}

/** A titled group of rows, announced by its title, with notes under the title. */
function Group({
  id,
  title,
  notes,
  empty,
  children,
}: {
  id: string;
  title: string;
  notes: string[];
  empty: string | null;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-labelledby={id}>
      <div
        id={id}
        className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-rim-text-faint"
      >
        {title}
      </div>
      {notes.map((note) => (
        <p key={note} className="px-3 pb-1 text-[11px] text-rim-text-faint">
          {note}
        </p>
      ))}
      {empty ? <p className="px-3 py-1.5 text-xs text-rim-text-faint">{empty}</p> : children}
    </div>
  );
}

/** What one row shows: a place with where it is, a message with its snippet, or a command. */
function RowContent({ row, nameOf }: { row: Row; nameOf: (id: string) => string | undefined }) {
  if (row.group === "places") {
    const Icon = row.place.label.startsWith("#") ? Hash : MessageSquare;
    return (
      <>
        <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{showInvisibleCharacters(row.place.label)}</span>
        {row.place.detail && (
          <span className="shrink-0 truncate text-[11px] text-rim-text-faint">
            {row.place.detail}
          </span>
        )}
      </>
    );
  }
  if (row.group === "messages") {
    const { message } = row;
    const author = message.author?.displayName || message.author?.username || "Someone";
    const where =
      message.conversationType === "CHANNEL"
        ? `#${message.conversationTitle ?? "channel"}`
        : (message.conversationTitle ?? "a direct message");
    return (
      <div className="min-w-0 flex-1">
        <SearchSnippet headline={message.headline} text={message.text ?? ""} nameOf={nameOf} />
        <p className="truncate text-[11px] text-rim-text-faint">
          {showInvisibleCharacters(author)} in {showInvisibleCharacters(where)} ·{" "}
          {formatRelativeTime(message.sentAt)}
        </p>
      </div>
    );
  }
  const { item, titleRanges } = row.match;
  return (
    <>
      <Terminal aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        <Highlight text={item.title} ranges={titleRanges} />
      </span>
      <span className="shrink-0 text-[10px] uppercase">{item.category}</span>
    </>
  );
}
