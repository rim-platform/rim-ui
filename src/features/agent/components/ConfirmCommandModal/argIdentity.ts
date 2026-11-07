import { useQuery } from "@tanstack/react-query";

import {
  CommandArgumentType,
  ConversationTypeEnum,
} from "../../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../../core/query/keys";
import { queryClient } from "../../../../core/query/queryClient";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { showInvisibleCharacters } from "../../../agents/runtime/invisibleCharacters";
import {
  findCachedConversation,
  requestConversation,
} from "../../../conversations/api/useConversation";
import type { ConversationSummary } from "../../../conversations/types";
import { looksLikeId } from "../../../commands/runtime/commandArguments";
import { isDirectSpace, useRelayStore } from "../../../relay/state/useRelayStore";
import { memberName } from "../../../workspaces/api/memberName";
import { myServersQueryOptions } from "../../../workspaces/api/useMyServers";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";

/** The arguments of a command by name, as the server declares their types. */
export type ArgumentTypes = Readonly<Record<string, CommandArgumentType>>;

/** The kinds of id a person can be told the name of. */
export type IdKind = "workspace" | "conversation" | "person";

const KIND_OF_TYPE: Partial<Record<CommandArgumentType, IdKind>> = {
  [CommandArgumentType.WORKSPACE_ID]: "workspace",
  [CommandArgumentType.CONVERSATION_ID]: "conversation",
  [CommandArgumentType.USER_ID]: "person",
};

/** The kinds of the argument names in use, for a command whose types are not at hand. */
const KIND_OF_NAME: ReadonlyMap<string, IdKind> = new Map([
  ["server_id", "workspace"],
  ["workspace_id", "workspace"],
  ["conversation_id", "conversation"],
  ["channel_id", "conversation"],
  ["target_conversation_id", "conversation"],
  ["user_id", "person"],
  ["dm_recipient_id", "person"],
]);

/**
 * The kind of id an argument holds: by its declared type when there is one, else by its name.
 *
 * @param name - The argument's name.
 * @param types - The command's declared argument types, when known.
 * @returns The kind, or `null` for an argument that holds no id with a name.
 */
export function idKindOfArg(name: string, types?: ArgumentTypes): IdKind | null {
  const declared = types?.[name];
  if (declared) return KIND_OF_TYPE[declared] ?? null;
  return KIND_OF_NAME.get(name) ?? null;
}

/**
 * The workspace a command's arguments name.
 *
 * @param args - The arguments as sent.
 * @param types - The command's declared argument types, when known.
 * @returns The first workspace id among them, or `null`.
 */
export function workspaceArgOf(
  args: Record<string, unknown>,
  types?: ArgumentTypes,
): string | null {
  for (const [name, value] of Object.entries(args)) {
    if (typeof value === "string" && value && idKindOfArg(name, types) === "workspace") {
      return value;
    }
  }
  return null;
}

/** What the dialog says about an id, in words that are safe to show. */
export interface ArgIdentity {
  /** What the id is, such as "Workspace" or "Channel". */
  label: string;
  /** The name; `null` when the client does not know one for this id. */
  name: string | null;
  /** Whether the name is still being asked for. */
  loading: boolean;
  /** Which workspace it is in, such as "in Rim Dev", when that is not the open one. */
  elsewhere: string | null;
}

function conversationWords(conversation: ConversationSummary): { label: string; name: string } {
  switch (conversation.conversationType) {
    case ConversationTypeEnum.CHANNEL:
      return { label: "Channel", name: `#${conversation.title ?? "channel"}` };
    case ConversationTypeEnum.GROUP:
      return { label: "Group", name: conversation.title || "A group without a name" };
    default:
      return { label: "Direct message", name: conversation.title || "A direct message" };
  }
}

const LABELS: Record<IdKind, string> = {
  workspace: "Workspace",
  conversation: "Conversation",
  person: "Person",
};

/**
 * Says what an id in a confirmation is, from the stores and the query cache. A conversation that
 * is not cached is asked of its workspace's server, which answers only for one the person can see.
 * A name is only ever looked up among ids of the same kind, and one that cannot be found stays
 * `null`, so it is never guessed.
 *
 * @param kind - The kind of id, or `null` when there is nothing to look up.
 * @param id - The id as it will be sent.
 * @param targetWorkspaceId - The workspace the command names, else the open one is used.
 * @returns The words for it, with every name's invisible characters shown by name.
 */
export function useArgIdentity(
  kind: IdKind | null,
  id: string | null,
  targetWorkspaceId: string | null,
): ArgIdentity {
  const openWorkspaceId = useWorkspaceStore((s) => s.workspaceId);
  const surface = useShellStore((s) => s.mainSurface.kind);
  const spaces = useRelayStore((s) => s.spaces);
  // Rerenders once the relay knows which space is the direct one.
  useRelayStore((s) => s.info?.directSpaceId);
  const { data: servers } = useQuery({ ...myServersQueryOptions(), enabled: false }, queryClient);

  const workspaceId = targetWorkspaceId ?? openWorkspaceId;
  const asked = kind === "conversation" && looksLikeId(workspaceId ?? "") && looksLikeId(id ?? "");
  const fetched = useQuery(
    {
      queryKey: queryKeys.conversation(workspaceId ?? undefined, id ?? undefined),
      enabled: asked,
      staleTime: 30_000,
      retry: false,
      networkMode: "always",
      queryFn: () => requestConversation(workspaceId!, id!),
    },
    queryClient,
  );

  function workspaceName(space: string): string | null {
    if (isDirectSpace(space)) return "Direct messages";
    return servers?.find((server) => server.id === space)?.name ?? spaces[space]?.name ?? null;
  }

  if (!kind || !id) return { label: "", name: null, loading: false, elsewhere: null };

  if (kind === "workspace") {
    const name = workspaceName(id);
    return {
      label: LABELS.workspace,
      name: name === null ? null : showInvisibleCharacters(name),
      loading: false,
      elsewhere: null,
    };
  }

  if (!workspaceId) return { label: LABELS[kind], name: null, loading: false, elsewhere: null };

  const notOpen = workspaceId !== openWorkspaceId || surface === "home" || surface === "unreads";
  const inWorkspace = workspaceName(workspaceId);
  const elsewhere = notOpen
    ? inWorkspace === null
      ? "in an unknown workspace"
      : `in ${showInvisibleCharacters(inWorkspace)}`
    : null;

  if (kind === "person") {
    const name = memberName(queryClient, workspaceId, id);
    return {
      label: LABELS.person,
      name: name === undefined ? null : showInvisibleCharacters(name),
      loading: false,
      elsewhere,
    };
  }

  const conversation = fetched.data ?? findCachedConversation(queryClient, workspaceId, id);
  if (!conversation || (conversation.serverId && conversation.serverId !== workspaceId)) {
    return { label: LABELS.conversation, name: null, loading: fetched.isFetching, elsewhere };
  }
  const { label, name } = conversationWords(conversation);
  return { label, name: showInvisibleCharacters(name), loading: false, elsewhere };
}

/**
 * Where a command will post, in a sentence's words.
 *
 * @param identity - What is known about the destination.
 * @returns The destination's name and workspace, or that it is unknown.
 */
export function destinationInWords(identity: ArgIdentity): string {
  const place = identity.name ?? (identity.loading ? "a conversation" : "an unknown conversation");
  return identity.elsewhere ? `${place} ${identity.elsewhere}` : place;
}
