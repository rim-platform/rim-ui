import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { handleDomain, personName } from "../../../shared/utils/handles";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { useConnectedAgentsStore } from "../../agents/state/useConnectedAgentsStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useChannels, useJoinedChannels } from "../../conversations/api/useChannels";
import { useInboxConversations } from "../../conversations/api/useInboxConversations";
import type { ConversationSummary } from "../../conversations/types";
import { directPeerId, untitledGroupName } from "../../conversations/utils";
import { useContactStore } from "../../relay/contacts/useContactStore";
import { useDirectInbox } from "../../relay/api/useDirectInbox";
import { isDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import { useMyMacros } from "../../macros/api/useMacros";
import { usePipelines } from "../../pipelines/api/usePipelines";
import { useMyServers } from "../../workspaces/api/useMyServers";
import { fetchServerMembers, useServerMembers } from "../../workspaces/api/useServerMembers";
import { useKnownHandles } from "../../workspaces/state/useKnownHandles";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { ownerName, workspaceLabels } from "../../workspaces/workspaceLabel";

/** What the palette can run a command on: a conversation or a workspace. */
export interface PickerTarget {
  id: string;
  /** The workspace the target is in; the target itself for a workspace. */
  serverId: string;
  label: string;
}

export interface Targets {
  items: PickerTarget[];
  isPending: boolean;
}

/** The names of the people in `conversations`, as the conversation list shows them. */
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
export function useNamed(conversations: readonly ConversationSummary[]): PickerTarget[] {
  const labelOf = useConversationLabels(conversations);
  return useMemo(
    () => conversations.map((c) => ({ id: c.id, serverId: c.serverId, label: labelOf(c) })),
    [conversations, labelOf],
  );
}

/**
 * The channels the viewer is in, and the DMs and groups, of a workspace, as the sidebar lists
 * them.
 *
 * @param inWorkspace - The workspace to list; the open one when left out.
 */
export function useChannelTargets(inWorkspace?: string): Targets {
  const openWorkspaceId = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  const workspaceId = inWorkspace ?? openWorkspaceId;
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
export function useDirectTargets(): Targets {
  const { items, isPending } = useDirectInbox();
  return { items: useNamed(items), isPending };
}

/** The open workspace's unarchived channels the viewer has not joined, as Browse channels lists them. */
export function useJoinableTargets(): Targets {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  const { data, isPending } = useChannels(workspaceId);
  const conversations = useMemo(
    () => (data?.items ?? []).filter((c) => !c.isMember && !c.isArchived),
    [data],
  );
  return { items: useNamed(conversations), isPending };
}

/** The workspaces on the rail other than the open one and the direct space. */
export function useWorkspaceTargets(): Targets {
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

/**
 * The open workspace's members, by the name the member list shows.
 *
 * @param messageable - Leave out the viewer and bots, who cannot be messaged.
 */
function useMembers(messageable: boolean): Targets {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  const viewerId = useAuthStore((s) => s.session?.userId);
  const { data, isPending } = useServerMembers(workspaceId);
  const items = useMemo(
    () =>
      (data ?? [])
        .filter((m) => !messageable || (m.userId !== viewerId && !m.isBot))
        .map((m) => ({
          id: m.userId,
          serverId: workspaceId ?? "",
          label: m.displayName || m.username,
        })),
    [data, messageable, viewerId, workspaceId],
  );
  return { items, isPending };
}

/** The open workspace's members. */
export function useMemberTargets(): Targets {
  return useMembers(false);
}

/** The open workspace's members who can be sent a direct message: not the viewer, not bots. */
export function useMessageableTargets(): Targets {
  return useMembers(true);
}

/** The viewer's macros in the open workspace, as Settings > Macros lists them. */
export function useMacroTargets(): Targets {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  const { data, isPending } = useMyMacros(workspaceId);
  const items = useMemo(
    () => (data ?? []).map((m) => ({ id: m.id, serverId: workspaceId ?? "", label: m.name })),
    [data, workspaceId],
  );
  return { items, isPending: Boolean(workspaceId) && isPending };
}

/** The open workspace's pipelines, each with whether it is on, as Settings > Pipelines lists them. */
export function usePipelineTargets(): Targets {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  const { data, isPending } = usePipelines(workspaceId);
  const items = useMemo(
    () =>
      (data ?? []).map((p) => ({
        id: p.id,
        serverId: workspaceId ?? "",
        label: `${p.name} (${p.enabled ? "on" : "off"})`,
      })),
    [data, workspaceId],
  );
  return { items, isPending: Boolean(workspaceId) && isPending };
}

/** The agents connected on this device, by the name each calls itself. */
export function useAgentTargets(): Targets {
  const agents = useConnectedAgentsStore((s) => s.agents);
  const items = useMemo(
    () =>
      agents.map((agent) => ({
        id: agent.id,
        serverId: "",
        label: showInvisibleCharacters(agent.name),
      })),
    [agents],
  );
  return { items, isPending: false };
}
