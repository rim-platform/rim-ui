import { useMemo, useState } from "react";

import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import { useArchivedChannels, useChannels } from "../api/useChannels";
import { useJoinChannelMutation } from "../api/useChannelMembership";
import { useOpenConversation } from "../hooks/useOpenConversation";
import type { ConversationSummary } from "../types";
import { memberCountLabel } from "../utils";
import { ChannelIcon } from "./ChannelIcon";

interface BrowseChannelsDialogProps {
  workspaceId: string;
  onClose: () => void;
}

/**
 * Every unarchived channel the viewer can see (public ones, joined or not, plus private ones
 * they belong to). Join adds a channel to the sidebar and opens it; View opens a public channel
 * without joining (the composer is replaced by a join bar). Owners and Moderators also see
 * archived channels under Archived, to open and unarchive them.
 */
export function BrowseChannelsDialog({ workspaceId, onClose }: BrowseChannelsDialogProps) {
  const [query, setQuery] = useState("");
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const { data, isPending, isError } = useChannels(workspaceId);
  const canModerate = useCanModerate(workspaceId);
  const { data: archivedData } = useArchivedChannels(workspaceId, canModerate);
  const join = useJoinChannelMutation();
  const openConversation = useOpenConversation();

  const channels = useMemo(() => matching(data?.items ?? [], query), [data, query]);
  const archived = useMemo(() => matching(archivedData ?? [], query), [archivedData, query]);

  function open(conversationId: string) {
    openConversation(conversationId, workspaceId);
    onClose();
  }

  function handleJoin(channel: ConversationSummary) {
    setJoiningId(channel.id);
    join.mutate(
      { serverId: workspaceId, conversationId: channel.id },
      {
        onSuccess: () => open(channel.id),
        onSettled: () => setJoiningId(null),
      },
    );
  }

  return (
    <Dialog open title="Browse channels" onClose={onClose} maxWidth="max-w-lg">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        placeholder="Search channels..."
        aria-label="Search channels"
        className="mb-3 w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
      />

      {join.error && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
        >
          {graphqlErrorMessage(join.error, "Could not join the channel")}
        </p>
      )}

      <div className="max-h-96 overflow-y-auto">
        {isPending && (
          <p className="px-2 py-6 text-center text-sm text-rim-text-muted">Loading channels...</p>
        )}
        {isError && (
          <p className="px-2 py-6 text-center text-sm text-rim-danger">Failed to load channels.</p>
        )}
        {!isPending && !isError && channels.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-rim-text-muted">
            {query.trim() ? "No channels match." : "No channels yet."}
          </p>
        )}
        <ul className="space-y-1">
          {channels.map((channel) => (
            <li
              key={channel.id}
              data-testid={`browse-channel-${channel.id}`}
              className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5"
            >
              <ChannelIcon
                conversation={channel}
                className="h-4 w-4 shrink-0 text-rim-text-muted"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-rim-text">{channel.title ?? "Untitled"}</p>
                <p className="truncate text-xs text-rim-text-faint">
                  {memberCountLabel(channel.memberCount)}
                  {channel.topic ? ` · ${channel.topic}` : ""}
                </p>
              </div>
              {channel.isMember ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => open(channel.id)}
                >
                  Open
                </Button>
              ) : (
                <div className="flex shrink-0 gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => open(channel.id)}>
                    View
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    isLoading={joiningId === channel.id}
                    disabled={joiningId !== null}
                    onClick={() => handleJoin(channel)}
                    aria-label={`Join ${channel.title ?? "channel"}`}
                  >
                    Join
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {archived.length > 0 && (
          <>
            <h3 className="mt-3 px-2 text-xs font-medium uppercase tracking-wider text-rim-text-faint">
              Archived
            </h3>
            <ul aria-label="Archived channels" className="space-y-1">
              {archived.map((channel) => (
                <li
                  key={channel.id}
                  data-testid={`browse-archived-${channel.id}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5"
                >
                  <ChannelIcon
                    conversation={channel}
                    className="h-4 w-4 shrink-0 text-rim-text-muted"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-rim-text">{channel.title ?? "Untitled"}</p>
                    <p className="truncate text-xs text-rim-text-faint">
                      Archived
                      {channel.topic ? ` · ${channel.topic}` : ""}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => open(channel.id)}>
                    View
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** The channels whose title or topic holds `query`, sorted by title. */
function matching(items: readonly ConversationSummary[], query: string): ConversationSummary[] {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? items.filter(
        (c) =>
          (c.title ?? "").toLowerCase().includes(needle) ||
          (c.topic ?? "").toLowerCase().includes(needle),
      )
    : items;
  return [...filtered].sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
}
