/**
 * The change a connected agent can ask for: sending a message. Each call names its target, is
 * checked against that agent's grants, is held by the server, and goes out only after the person
 * confirms the exact text in RIM. The text never reaches the record or a log.
 */

import {
  CommandResultStatus,
  type CommandResult,
  type ConfirmationProofInput,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import { readRefusal, refusalForAgent } from "../../commands/runtime/refusal";
import type { RecordEntry } from "../state/useAgentRecordStore";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import { denied, errorName, failed, idOf, type ToolArgs, type ToolOutcome } from "./agentReads";
import { grantCovers, grantMayCover, type GrantChannel } from "./grants";

/** What the person is asked to confirm, and the server's challenge to answer if they do. */
export interface AgentConfirmation {
  agentName: string;
  workspaceName: string;
  channelName: string;
  text: string;
  expiresAt: string;
  token: string;
  argsHash: string;
}

/** Holds back an agent whose last request was discarded or expired. */
export interface Cooldown {
  /** Whether the agent's next request is still turned away. */
  active: (agentId: string) => boolean;
  /** Starts the wait for this agent. */
  start: (agentId: string) => void;
}

/** What the changes need from the app. */
export interface AgentChangesDeps {
  /** The conversation by id; `null` when it cannot be found or seen. */
  lookup: (workspaceId: string, channelId: string) => Promise<GrantChannel | null>;
  workspaces: () => Promise<{ id: string; name: string }[]>;
  isDirectSpace: (workspaceId: string) => boolean;
  /** Whether the agent is still connected to the unlocked account. */
  connected: (agentId: string) => boolean;
  /** The channel's name as RIM knows it. */
  channelName: (workspaceId: string, channelId: string) => Promise<string>;
  /** `executeCommand` for `chat.post_message`, initiator AGENT, naming only the ids it was given. */
  post: (input: {
    workspaceId: string;
    channelId: string;
    text: string;
    proof?: ConfirmationProofInput;
  }) => Promise<CommandResult>;
  /** Whether a confirmation is open now. */
  busy: () => boolean;
  /** Shows the dialog. Answers "busy" at once when any confirmation is open. */
  confirm: (request: AgentConfirmation) => Promise<"approved" | "discarded" | "busy">;
  /** Keeps an entry. A failure before anything is posted refuses the call. */
  record: (entry: RecordEntry) => Promise<void>;
  /** Shared with every other request that asks the person. */
  cooldown: Cooldown;
  now: () => number;
}

/** The running changes, one function per tool. */
export interface AgentChanges {
  sendMessage: (agent: ConnectedAgent, args: ToolArgs) => Promise<ToolOutcome>;
}

const TOOL = "rim_send_message";
/** How long after a discard or an expiry an agent's next request is turned away. */
const COOLDOWN_MS = 10_000;

const INVALID: ToolOutcome = {
  isError: true,
  payload: { refusal: "INVALID", message: "Give workspaceId, channelId and text." },
};
/** The answer while an agent is held back. */
export const COOLING_DOWN: ToolOutcome = {
  isError: true,
  payload: { refusal: "FAILED", retrySafe: true, message: "Wait ten seconds, then try again." },
};
/** The answer while another confirmation is open. */
export const BUSY: ToolOutcome = {
  isError: true,
  payload: {
    refusal: "FAILED",
    retrySafe: true,
    message: "The person is answering something else in RIM. Try again shortly.",
  },
};
const EXPIRED: ToolOutcome = {
  isError: true,
  payload: {
    outcome: "expired",
    message: "The person didn't answer in time. Nothing was sent. Ask them before trying again.",
  },
};
const DISCARDED: ToolOutcome = {
  isError: true,
  payload: {
    outcome: "discarded",
    message: "The person chose not to send this. Do not send it again unless they ask.",
  },
};
const SEND_FAILED_TEXT = "RIM could not send this.";
const NO_ANSWER_TEXT =
  "RIM got no usable answer from the server. Ask the person before trying again.";

/** Which call an entry in the record is about. */
interface Call {
  agent: ConnectedAgent;
  workspaceId: string | null;
  channelId: string | null;
}

/** What the agent is told about a failed post. The message is the server's own. */
function refusalOf(error: unknown): ToolOutcome {
  const refusal = readRefusal(error);
  return {
    isError: true,
    payload: {
      refusal: refusal?.kind ?? "FAILED",
      retrySafe: refusal?.kind === "FAILED" && refusal.retrySafe,
      message: refusalForAgent(error) ?? NO_ANSWER_TEXT,
    },
  };
}

/** The new message's id in a `chat.post_message` result, if it has one. */
function messageIdOf(result: CommandResult): string | null {
  const payload: unknown = result.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as { message_id?: unknown }).message_id;
  return typeof id === "string" ? id : null;
}

/**
 * Creates a cooldown.
 *
 * @param now - The clock it measures the wait by.
 * @returns The cooldown, with no agent held back.
 */
export function createCooldown(now: () => number): Cooldown {
  const lastEnded = new Map<string, number>();
  return {
    active(agentId) {
      const last = lastEnded.get(agentId);
      return last !== undefined && now() - last < COOLDOWN_MS;
    },
    start(agentId) {
      lastEnded.set(agentId, now());
    },
  };
}

/**
 * Creates the changes.
 *
 * @param deps - The lookups, the server call, the dialog and the record.
 * @returns One function per tool. None rejects on a refusal or a failed post.
 */
export function createAgentChanges(deps: AgentChangesDeps): AgentChanges {
  function entry(
    call: Call,
    change: NonNullable<RecordEntry["change"]>,
    messageIds: string[] = [],
  ): RecordEntry {
    return {
      at: new Date(deps.now()).toISOString(),
      agentId: call.agent.id,
      agentName: call.agent.name,
      tool: TOOL,
      workspaceId: call.workspaceId ?? "",
      channelId: call.channelId,
      query: false,
      messageIds,
      refused: change === "refused",
      change,
    };
  }

  /**
   * Keeps the entry. The check and the store's write run with no wait between them, so an entry
   * cannot land in another account's record after a lock.
   */
  async function keep(recordEntry: RecordEntry): Promise<void> {
    if (!deps.connected(recordEntry.agentId)) throw new Error("not connected");
    await deps.record(recordEntry);
  }

  /** Keeps the entry for how a call ended, whose answer does not depend on that working. */
  async function ended(recordEntry: RecordEntry, outcome: ToolOutcome): Promise<ToolOutcome> {
    await keep(recordEntry).catch((error: unknown) => {
      logger.warn("[RIM:agents] could not record how a request ended:", errorName(error));
    });
    return outcome;
  }

  function sent(call: Call, channelId: string, result: CommandResult): Promise<ToolOutcome> {
    const messageId = messageIdOf(result);
    return ended(entry(call, "sent", messageId === null ? [] : [messageId]), {
      isError: false,
      payload: { outcome: "sent", channelId, messageId },
    });
  }

  function expired(call: Call): Promise<ToolOutcome> {
    deps.cooldown.start(call.agent.id);
    return ended(entry(call, "expired"), EXPIRED);
  }

  /** @returns The workspace, when the agent's grant covers the channel and it is one RIM lists. */
  async function grantedWorkspace(
    agent: ConnectedAgent,
    workspaceId: string,
    channelId: string,
  ): Promise<{ id: string; name: string } | null> {
    const grants = agent.grants ?? {};
    if (deps.isDirectSpace(workspaceId)) return null;
    if (!grantMayCover(grants, workspaceId, channelId)) return null;
    const channel = await deps.lookup(workspaceId, channelId).catch(() => null);
    if (!grantCovers(grants, workspaceId, channel)) return null;
    const listed = await deps.workspaces().catch(() => []);
    return listed.find((workspace) => workspace.id === workspaceId) ?? null;
  }

  return {
    async sendMessage(agent, args) {
      const workspaceId = idOf(args.workspaceId);
      const channelId = idOf(args.channelId);
      const { text } = args;
      const call: Call = { agent, workspaceId, channelId };
      if (
        workspaceId === null ||
        channelId === null ||
        typeof text !== "string" ||
        text.trim() === ""
      ) {
        return ended(entry(call, "refused"), INVALID);
      }

      if (deps.cooldown.active(agent.id)) return COOLING_DOWN;

      const workspace = await grantedWorkspace(agent, workspaceId, channelId);
      if (workspace === null) return ended(entry(call, "refused"), denied());

      // Before asking the server, whose limit on unanswered challenges would otherwise let requests
      // made during a dialog push out the challenge that dialog holds.
      if (deps.busy()) return BUSY;

      try {
        await keep(entry(call, "asked"));
      } catch (error) {
        logger.warn("[RIM:agents] could not record a request:", errorName(error));
        return failed(SEND_FAILED_TEXT);
      }

      const input = { workspaceId, channelId, text };
      let held: CommandResult;
      try {
        held = await deps.post(input);
      } catch (error) {
        return ended(entry(call, "refused"), refusalOf(error));
      }
      if (held.status === CommandResultStatus.SUCCESS) return sent(call, channelId, held);
      const challenge = held.confirmationRequired;
      if (held.status !== CommandResultStatus.CONFIRMATION_REQUIRED || !challenge) {
        return ended(entry(call, "refused"), failed(SEND_FAILED_TEXT));
      }

      const decision = await deps.confirm({
        agentName: agent.name,
        workspaceName: workspace.name,
        channelName: await deps.channelName(workspaceId, channelId).catch(() => channelId),
        text,
        expiresAt: challenge.expiresAt,
        token: challenge.token,
        argsHash: challenge.argsHash,
      });
      if (decision === "busy") return ended(entry(call, "busy"), BUSY);
      if (decision === "discarded") {
        if (deps.now() >= Date.parse(challenge.expiresAt)) return expired(call);
        deps.cooldown.start(agent.id);
        return ended(entry(call, "discarded"), DISCARDED);
      }

      // A lock ends the dialog as discarded, so here the account is still the one that confirmed
      // and the entry is kept even though the agent has just been disconnected.
      if (!deps.connected(agent.id)) {
        await deps.record(entry(call, "refused")).catch((error: unknown) => {
          logger.warn("[RIM:agents] could not record how a request ended:", errorName(error));
        });
        return denied();
      }

      let done: CommandResult;
      try {
        done = await deps.post({
          ...input,
          proof: { inBandToken: { token: challenge.token, argsHash: challenge.argsHash } },
        });
      } catch (error) {
        if (readRefusal(error)?.kind === "EXPIRED") return expired(call);
        return ended(entry(call, "refused"), refusalOf(error));
      }
      if (done.status === CommandResultStatus.SUCCESS) return sent(call, channelId, done);
      return ended(entry(call, "refused"), failed(SEND_FAILED_TEXT));
    },
  };
}
