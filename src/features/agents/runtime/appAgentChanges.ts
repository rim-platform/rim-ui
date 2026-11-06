/** The agent changes wired to the app: its server, its confirmation dialog and its record. */

import { graphqlClient } from "../../../core/graphql/client";
import {
  CommandInitiator,
  CommandSensitivity,
  type CommandResult,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import {
  useConfirmationModalStore,
  type ConfirmationRequest,
} from "../../agent/state/confirmationModalStore";
import { EXECUTE_COMMAND_MUTATION } from "../../agent/tools/loader";
import { fetchConversation } from "../../conversations/api/useConversation";
import { desktopShowWindow } from "../../desktop-shell/api/desktopShell";
import { isDirectSpace } from "../../relay/state/useRelayStore";
import { createAgentChanges, createCooldown, type AgentConfirmation } from "./agentChanges";
import { connected, lookup, record, workspaces } from "./appAgentReads";

const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/** The channel's title, falling back on its id. */
async function channelName(workspaceId: string, channelId: string): Promise<string> {
  const conversation = await fetchConversation(queryClient, workspaceId, channelId);
  return conversation?.title ?? channelId;
}

/**
 * Ends the request when it expires. The dialog does this while it shows, but agents are answered
 * from the sign-in screen on, where it is not mounted.
 *
 * @returns Cancels the timer.
 */
function endAtExpiry({
  token,
  expiresAt,
}: Pick<AgentConfirmation, "token" | "expiresAt">): () => void {
  const delay = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(delay) || delay > MAX_TIMER_DELAY_MS) return () => undefined;
  const timer = setTimeout(
    () => {
      const { request, reject } = useConfirmationModalStore.getState();
      if (request?.token === token) reject();
    },
    Math.max(delay, 0),
  );
  return () => clearTimeout(timer);
}

/**
 * Shows an outside agent's request unless a confirmation is open, brings the window forward and
 * ends the request when it expires.
 *
 * @returns How the person answered, or "busy" at once when a confirmation is open.
 */
export async function askPerson(
  request: ConfirmationRequest,
): Promise<"approved" | "discarded" | "busy"> {
  const decision = useConfirmationModalStore.getState().openIfFree(request);
  if (decision === null) return "busy";
  desktopShowWindow().catch(() => {
    logger.warn("[RIM:agents] could not bring the window forward");
  });
  const stopTimer = endAtExpiry(request);
  const { approved } = await decision;
  stopTimer();
  return approved ? "approved" : "discarded";
}

function confirm(request: AgentConfirmation): Promise<"approved" | "discarded" | "busy"> {
  return askPerson({
    initiator: "agent",
    commandId: "chat.post_message",
    toolName: "send a message",
    args: {},
    sensitivity: CommandSensitivity.MUTATING,
    verb: null,
    token: request.token,
    argsHash: request.argsHash,
    expiresAt: request.expiresAt,
    outsideAgent: {
      name: request.agentName,
      target: [
        { label: "Workspace", value: request.workspaceName },
        { label: "Channel", value: request.channelName },
      ],
      text: request.text,
    },
  });
}

/** Whether a confirmation is open now. */
export function confirmationOpen(): boolean {
  return useConfirmationModalStore.getState().request !== null;
}

/** The wait after a discard or an expiry, shared by everything that asks the person. */
export const agentCooldown = createCooldown(() => Date.now());

/** The changes this app answers agents with. */
export const appAgentChanges = createAgentChanges({
  lookup,
  workspaces,
  isDirectSpace,
  connected,
  channelName,
  busy: confirmationOpen,
  post: async ({ workspaceId, channelId, text, proof }) => {
    const answer = await graphqlClient.request<{ executeCommand: CommandResult }>(
      EXECUTE_COMMAND_MUTATION,
      {
        input: {
          commandId: "chat.post_message",
          args: { server_id: workspaceId, conversation_id: channelId, text },
          commandContext: { workspaceId, conversationId: channelId },
          initiator: CommandInitiator.AGENT,
          ...(proof ? { confirmation: proof } : {}),
        },
      },
    );
    return answer.executeCommand;
  },
  confirm,
  record,
  cooldown: agentCooldown,
  now: () => Date.now(),
});
