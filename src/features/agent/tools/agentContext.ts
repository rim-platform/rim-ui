import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore, type MainSurface } from "../../../shell/state/useShellStore";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { findCachedConversation } from "../../conversations/api/useConversation";
import type { ConversationSummary } from "../../conversations/types";
import { isDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import type { Server } from "../../workspaces/api/useMyServers";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

const MAX_NAME_CHARACTERS = 80;
const MAX_WORKSPACES_NAMED = 30;

/** What the agent is told about where the person is, with names from the local caches. */
export interface AgentContext {
  /** The view open in the main surface, in words. */
  surface: string;
  /** Whether a conversation is what the main surface shows. */
  conversationOnScreen: boolean;
  /** The selected workspace or direct space, which stays selected on Home and in Settings. */
  workspaceId: string | null;
  /** The selected workspace's name; `null` when it is not cached or is the direct space. */
  workspaceName: string | null;
  /** Whether the selected space is the direct space, which has no channels. */
  inDirectMessages: boolean;
  /** Whether a workspace is what the person is looking at. */
  workspaceOnScreen: boolean;
  conversationId: string | null;
  /** The selected channel's name; `null` when it is not cached or not {@link namedChannel}. */
  conversationName: string | null;
  threadOpen: boolean;
  /** The person's workspaces on this server, without direct spaces; `null` when not cached. */
  workspaces: { id: string; name: string }[] | null;
  /** The names of the person's workspaces on other servers, which the tools cannot reach. */
  workspacesElsewhere: string[];
  /** Whether the selected workspace is one on another server. */
  selectedIsElsewhere: boolean;
}

/**
 * A name from people, made safe to place in a prompt: invisible characters are shown by name, it
 * is cut to a bounded length, and it is quoted so that a line break or a quote stays inside it.
 *
 * @param name - The name as stored.
 * @returns The name in double quotes, with its line breaks and quotes escaped.
 */
export function quoteName(name: string): string {
  const shown = Array.from(showInvisibleCharacters(name));
  const cut = shown.length > MAX_NAME_CHARACTERS;
  return JSON.stringify(shown.slice(0, MAX_NAME_CHARACTERS).join("") + (cut ? "..." : ""));
}

function surfaceInWords(
  surface: MainSurface,
  inDirectMessages: boolean,
  hasConversation: boolean,
): string {
  switch (surface.kind) {
    case "conversation":
      if (inDirectMessages) {
        return hasConversation
          ? "Direct messages, with a conversation open"
          : "Direct messages, with no conversation selected";
      }
      return hasConversation ? "a conversation" : "a workspace, with no conversation selected";
    case "settings":
      return "Settings";
    case "plugin":
      return "a plugin's page";
    case "audit-log":
      return "the audit log";
    case "home":
      return "Home, across every workspace";
    case "unreads":
      return "Unreads, across every workspace";
    case "dm-requests":
      return "message requests";
    case "agent-sessions":
    case "agent-session":
      return "agent sessions";
  }
}

function cachedConversation(
  workspaceId: string | null,
  conversationId: string | null,
): ConversationSummary | undefined {
  if (!workspaceId || !conversationId) return undefined;
  return (
    queryClient.getQueryData<ConversationSummary>(
      queryKeys.conversation(workspaceId, conversationId),
    ) ?? findCachedConversation(queryClient, workspaceId, conversationId)
  );
}

/**
 * The title the model may be told without being asked: that of an unencrypted channel, which its
 * list tool returns anyway. The title of a direct message or a group, encrypted ones among them,
 * stays out of the prompt.
 *
 * @param conversation - The conversation as cached, when it is.
 * @returns The title, or `null` when it is not to be told or not known.
 */
function namedChannel(conversation: ConversationSummary | undefined): string | null {
  if (conversation?.conversationType !== ConversationTypeEnum.CHANNEL) return null;
  return conversation.encryptedAt ? null : (conversation.title ?? null);
}

/**
 * Where the person is right now, from the stores and the query cache. Nothing is fetched, so a
 * name that is not cached comes back as `null`.
 *
 * @returns The current view, the selected workspace and conversation, and the person's workspaces.
 */
export function readAgentContext(): AgentContext {
  const shell = useShellStore.getState();
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  const conversationId = shell.selectedConversationId;
  const inDirectMessages = isDirectSpace(workspaceId);
  const kind = shell.mainSurface.kind;
  const spaces = useRelayStore.getState().spaces;
  const elsewhere = Object.values(spaces).filter((space) => space.kind === "workspace");
  const servers = queryClient.getQueryData<Server[]>(queryKeys.myServers());
  const workspaces = servers
    ? servers
        .filter((server) => !isDirectSpace(server.id))
        .slice(0, MAX_WORKSPACES_NAMED)
        .map((server) => ({ id: server.id, name: server.name }))
    : null;

  return {
    surface: surfaceInWords(shell.mainSurface, inDirectMessages, Boolean(conversationId)),
    conversationOnScreen: kind === "conversation" && Boolean(conversationId),
    workspaceId,
    workspaceName: inDirectMessages
      ? null
      : (servers?.find((server) => server.id === workspaceId)?.name ??
        (workspaceId ? spaces[workspaceId]?.name : null) ??
        null),
    inDirectMessages,
    workspaceOnScreen:
      Boolean(workspaceId) && !inDirectMessages && kind !== "home" && kind !== "unreads",
    conversationId,
    conversationName: namedChannel(cachedConversation(workspaceId, conversationId)),
    threadOpen: shell.isThreadOpen,
    workspaces,
    workspacesElsewhere: elsewhere
      .slice(0, MAX_WORKSPACES_NAMED)
      .map((space) => space.name)
      .filter((name) => name !== undefined),
    selectedIsElsewhere: elsewhere.some((space) => space.spaceId === workspaceId),
  };
}
