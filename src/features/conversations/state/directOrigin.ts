import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import {
  useShellStore,
  type DirectDraft,
  type DirectOrigin,
} from "../../../shell/state/useShellStore";
import type { SpaceRecord } from "../../relay/state/relayDb";
import { isDirectSpace, useRelayStore } from "../../relay/state/useRelayStore";
import type { Server } from "../../workspaces/api/useMyServers";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/**
 * Keeps where the viewer is before a DM or group of `spaceId` opens: the open workspace and its
 * conversation, unless that workspace is a direct space itself. `openedId` is the conversation
 * opened, or null for a draft.
 */
export function rememberDirectOrigin(spaceId: string, openedId: string | null): void {
  const current = useWorkspaceStore.getState().workspaceId;
  if (!current || current === spaceId || isDirectSpace(current)) return;
  const shell = useShellStore.getState();
  shell.setDirectOrigin({
    workspaceId: current,
    conversationId: shell.selectedConversationId,
    spaceId,
    openedId,
  });
}

/** Whether `origin` applies to the open workspace and the conversation or draft it shows. */
function applies(
  origin: DirectOrigin | null,
  workspaceId: string | null,
  selectedConversationId: string | null,
  draft: DirectDraft | null,
): origin is DirectOrigin {
  if (!origin || workspaceId !== origin.spaceId) return false;
  if (origin.openedId !== null) return origin.openedId === selectedConversationId;
  return draft !== null && "spaceId" in draft && draft.spaceId === origin.spaceId;
}

/** The direct origin that applies to what the shell shows now, or null. */
export function applicableDirectOrigin(): DirectOrigin | null {
  const { directOrigin, selectedConversationId, draftDirect } = useShellStore.getState();
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  return applies(directOrigin, workspaceId, selectedConversationId, draftDirect)
    ? directOrigin
    : null;
}

/**
 * The name of `workspaceId` when it is one of the viewer's workspaces, on this server or on
 * another one, as the workspace rail lists them; null otherwise.
 */
export function workspaceNameOf(
  workspaceId: string,
  servers: readonly Pick<Server, "id" | "name">[] | undefined,
  spaces: Readonly<Record<string, SpaceRecord>>,
  forked: readonly string[],
): string | null {
  const server = servers?.find((s) => s.id === workspaceId);
  if (server) return server.name;
  const space = spaces[workspaceId];
  if (space?.kind !== "workspace" || forked.includes(space.hostServerId)) return null;
  return space.name ?? "Workspace";
}

/**
 * Returns to the workspace and conversation the shown DM was opened from. Returns false when
 * no origin applies or the workspace is no longer the viewer's (the origin is then dropped).
 */
export function returnFromDirect(): boolean {
  const origin = applicableDirectOrigin();
  if (!origin) return false;
  const { spaces, forked } = useRelayStore.getState();
  const servers = queryClient.getQueryData<Server[]>(queryKeys.myServers());
  if (workspaceNameOf(origin.workspaceId, servers, spaces, forked) === null) {
    useShellStore.getState().setDirectOrigin(null);
    return false;
  }
  useWorkspaceStore.getState().setWorkspaceId(origin.workspaceId);
  if (origin.conversationId) {
    useShellStore.getState().setSelectedConversationId(origin.conversationId);
  }
  return true;
}

/** {@link applicableDirectOrigin}, kept current for rendering. */
export function useApplicableDirectOrigin(): DirectOrigin | null {
  const directOrigin = useShellStore((s) => s.directOrigin);
  const selectedConversationId = useShellStore((s) => s.selectedConversationId);
  const draftDirect = useShellStore((s) => s.draftDirect);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  return applies(directOrigin, workspaceId, selectedConversationId, draftDirect)
    ? directOrigin
    : null;
}
