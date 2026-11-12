/**
 * The reads a connected agent can ask for. Each takes explicit ids, is checked against that
 * agent's grants, reads through the client message service with only the plain read capability,
 * and is recorded before it is returned.
 */

import { logger } from "../../../core/logger";
import { CHAT_READ, ChatMethod } from "../../plugins/chat/chatTypes";
import type { PluginChatMessage, PluginMessagePage } from "../../plugins/chat/chatTypes";
import { createMessageService, type ChatDeps } from "../../plugins/chat/messageService";
import { ErrorCode, RpcError } from "../../plugins/web/rpc";
import type { RecordEntry } from "../state/useAgentRecordStore";
import type { ConnectedAgent } from "../state/useConnectedAgentsStore";
import type { MissingGrant } from "./grantRefusals";
import { grantCovers, grantMayCover, hasGrantIn, type GrantChannel } from "./grants";

/** A read's arguments, as the agent sent them. */
export type ToolArgs = Record<string, unknown>;

/** What a tool answers: what goes back to the agent, and whether it is a refusal. */
export interface ToolOutcome {
  isError: boolean;
  payload: object;
}

/** A channel as the workspace lists it. */
export interface AgentChannel extends GrantChannel {
  name: string;
  private: boolean;
}

/** What the reads need from the app. */
export interface AgentReadsDeps {
  chat: ChatDeps;
  /** The conversation by id; `null` when it cannot be found or seen. */
  lookup: (workspaceId: string, channelId: string) => Promise<GrantChannel | null>;
  workspaces: () => Promise<{ id: string; name: string }[]>;
  channels: (workspaceId: string) => Promise<AgentChannel[]>;
  isDirectSpace: (workspaceId: string) => boolean;
  /** Whether the agent is still connected to the unlocked account. */
  connected: (agentId: string) => boolean;
  /** Keeps an entry. A failure refuses the read. */
  record: (entry: RecordEntry) => Promise<void>;
  /**
   * Hears of a read refused only because no grant covers a channel the person could grant, so
   * the app can offer that grant; ids only. Without it, nothing is told.
   */
  missingGrant?: {
    wanted: (refusal: MissingGrant) => boolean;
    report: (refusal: MissingGrant) => void;
  };
}

/** The running reads, one function per tool. */
export interface AgentReads {
  listWorkspaces: (agent: ConnectedAgent) => Promise<ToolOutcome>;
  listChannels: (agent: ConnectedAgent, args: ToolArgs) => Promise<ToolOutcome>;
  readMessages: (agent: ConnectedAgent, args: ToolArgs) => Promise<ToolOutcome>;
  searchMessages: (agent: ConnectedAgent, args: ToolArgs) => Promise<ToolOutcome>;
}

const DEFAULT_LIMIT = 50;
/** Most hits asked for in a search of a whole workspace, before those outside the grant go. */
const WORKSPACE_SEARCH_HITS = 100;
/** The capabilities every read runs with: plain reading, so encrypted conversations are refused. */
const READ_ONLY = [CHAT_READ] as const;
/** The shape of an id RIM could have issued. Anything else is treated as unknown, and not kept. */
const ID_SHAPE = /^[A-Za-z0-9_:.-]{1,128}$/;

const DENIED_TEXT =
  "You have no grant for this channel. The person can grant it in RIM's Settings > Agents.";
const NOT_STORED_TEXT = "This channel is not stored on this device yet. Try again shortly.";
const FAILED_TEXT = "RIM could not read this.";

/** The one refusal for a conversation an agent may not reach, whatever the reason. */
export function denied(): ToolOutcome {
  return { isError: true, payload: { refusal: "DENIED", message: DENIED_TEXT } };
}

/** A refusal for a technical reason. */
export function failed(message: string = FAILED_TEXT): ToolOutcome {
  return { isError: true, payload: { refusal: "FAILED", message } };
}

/** What may be logged about a failure: its class, and nothing it carried. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/** The limit an agent gave or the default, or `null` when it gave one outside the range. */
function limitOf(value: unknown): number | null {
  const limit = value ?? DEFAULT_LIMIT;
  return typeof limit === "number" &&
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= WORKSPACE_SEARCH_HITS
    ? limit
    : null;
}

/** The id an agent gave, or `null` when it is not shaped like one RIM could have issued. */
export function idOf(value: unknown): string | null {
  return typeof value === "string" && ID_SHAPE.test(value) ? value : null;
}

/** The refusal for a failure of the message service. Nothing from the failure reaches the agent. */
function refusalFor(error: unknown): ToolOutcome {
  if (!(error instanceof RpcError)) return failed();
  if (error.code === ErrorCode.CAPABILITY_DENIED) return denied();
  if (error.code === ErrorCode.INVALID_PARAMS && error.message.startsWith("unknown conversation")) {
    return denied();
  }
  const { reason } = (error.data ?? {}) as { reason?: unknown };
  return reason === "notCached" ? failed(NOT_STORED_TEXT) : failed();
}

/** A message as an agent gets it, built field by field so nothing else can come along. */
function toMessage(message: PluginChatMessage) {
  return {
    id: message.id,
    channelId: message.conversationId,
    threadId: message.threadId,
    author: message.author.displayName || "unknown",
    text: message.text,
    sentAt: message.sentAt,
    editedAt: message.editedAt,
    attachments: message.attachments.map((attachment) => ({
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
    })),
  };
}

/** Which call an entry in the record is about. */
interface Call {
  agent: ConnectedAgent;
  tool: string;
  workspaceId: string | null;
  channelId: string | null;
  query: boolean;
}

/**
 * Creates the reads.
 *
 * @param deps - The message service's dependencies, the lookups and the record.
 * @returns One function per tool. None rejects: a failure is a refusal.
 */
export function createAgentReads(deps: AgentReadsDeps): AgentReads {
  /** A service bound to the given workspace, whichever one is open, that cannot post. */
  function serviceFor(workspaceId: string) {
    return createMessageService({
      ...deps.chat,
      workspaceId: () => workspaceId,
      post: () => Promise.reject(new Error("agents cannot post")),
      recordEncryptedReads: async () => {},
    });
  }

  /**
   * Keeps the entry. The check and the store's write run with no wait between them, so an entry
   * cannot land in another account's record after a lock.
   */
  async function record(call: Call, messageIds: string[], refused: boolean): Promise<void> {
    if (!deps.connected(call.agent.id)) throw new Error("not connected");
    await deps.record({
      at: new Date().toISOString(),
      agentId: call.agent.id,
      agentName: call.agent.name,
      tool: call.tool,
      workspaceId: call.workspaceId ?? "",
      channelId: call.channelId,
      query: call.query,
      messageIds,
      refused,
    });
  }

  async function refuse(call: Call, outcome: ToolOutcome): Promise<ToolOutcome> {
    await record(call, [], true).catch((error: unknown) => {
      logger.warn("[RIM:agents] could not record a refusal:", errorName(error));
    });
    return outcome;
  }

  /** Records what is handed over, and hands it over only if that worked. */
  async function handOver(call: Call, messageIds: string[], payload: object): Promise<ToolOutcome> {
    try {
      await record(call, messageIds, false);
    } catch (error) {
      logger.warn("[RIM:agents] could not record a read:", errorName(error));
      return failed();
    }
    return { isError: false, payload };
  }

  function grantsOf(agent: ConnectedAgent) {
    return agent.grants ?? {};
  }

  /** Whether the agent's grants reach into this workspace at all. */
  function workspaceGranted(agent: ConnectedAgent, workspaceId: string | null): boolean {
    return (
      workspaceId !== null &&
      !deps.isDirectSpace(workspaceId) &&
      hasGrantIn(grantsOf(agent), workspaceId)
    );
  }

  /** Whether the agent's grant covers the conversation. Only a possibly covered id is looked up. */
  async function covered(
    agent: ConnectedAgent,
    workspaceId: string | null,
    channelId: string | null,
  ): Promise<boolean> {
    if (workspaceId === null || channelId === null) return false;
    if (!workspaceGranted(agent, workspaceId)) return false;
    if (!grantMayCover(grantsOf(agent), workspaceId, channelId)) return false;
    const channel = await deps.lookup(workspaceId, channelId).catch(() => null);
    return grantCovers(grantsOf(agent), workspaceId, channel);
  }

  /**
   * Tells the app of a refusal for a channel the grants do not cover, once the channel is looked
   * up and is one a grant could cover: a channel, not encrypted, that the person can see. The
   * refusal itself does not wait for this.
   */
  function noteMissingGrant(
    agent: ConnectedAgent,
    workspaceId: string | null,
    channelId: string | null,
  ): void {
    const listener = deps.missingGrant;
    if (!listener || workspaceId === null || channelId === null) return;
    if (deps.isDirectSpace(workspaceId)) return;
    const refusal: MissingGrant = { agentId: agent.id, workspaceId, conversationId: channelId };
    if (!listener.wanted(refusal)) return;
    void deps
      .lookup(workspaceId, channelId)
      .then((channel) => {
        if (channel === null || !channel.isChannel || channel.encrypted) return;
        if (grantCovers(grantsOf(agent), workspaceId, channel)) return;
        listener.report(refusal);
      })
      .catch(() => {});
  }

  /** @returns The messages in conversations the grant covers, looking each one up once. */
  async function keepCovered(
    agent: ConnectedAgent,
    workspaceId: string,
    messages: PluginChatMessage[],
  ): Promise<PluginChatMessage[]> {
    const conversations = [...new Set(messages.map((message) => message.conversationId))];
    const verdicts = await Promise.all(
      conversations.map((id) => covered(agent, workspaceId, idOf(id))),
    );
    const allowed = new Set(conversations.filter((_, index) => verdicts[index]));
    return messages.filter((message) => allowed.has(message.conversationId));
  }

  return {
    async listWorkspaces(agent) {
      const call: Call = {
        agent,
        tool: "rim_list_workspaces",
        workspaceId: null,
        channelId: null,
        query: false,
      };
      let listed: { id: string; name: string }[] = [];
      if (Object.keys(grantsOf(agent)).some((id) => workspaceGranted(agent, id))) {
        try {
          listed = await deps.workspaces();
        } catch {
          return refuse(call, failed());
        }
      }
      const workspaces = listed
        .filter((workspace) => workspaceGranted(agent, workspace.id))
        .map((workspace) => ({ id: workspace.id, name: workspace.name }));
      return handOver(call, [], { untrusted: true, workspaces });
    },

    async listChannels(agent, args) {
      const workspaceId = idOf(args.workspaceId);
      const call: Call = {
        agent,
        tool: "rim_list_channels",
        workspaceId,
        channelId: null,
        query: false,
      };
      if (workspaceId === null || !workspaceGranted(agent, workspaceId)) {
        return refuse(call, denied());
      }
      let listed: AgentChannel[];
      try {
        listed = await deps.channels(workspaceId);
      } catch {
        return refuse(call, failed());
      }
      const channels = listed
        .filter((channel) => grantCovers(grantsOf(agent), workspaceId, channel))
        .map((channel) => ({ id: channel.id, name: channel.name, private: channel.private }));
      return handOver(call, [], { untrusted: true, channels });
    },

    async readMessages(agent, args) {
      const workspaceId = idOf(args.workspaceId);
      const channelId = idOf(args.channelId);
      const call: Call = { agent, tool: "rim_read_messages", workspaceId, channelId, query: false };
      if (
        workspaceId === null ||
        channelId === null ||
        !(await covered(agent, workspaceId, channelId))
      ) {
        noteMissingGrant(agent, workspaceId, channelId);
        return refuse(call, denied());
      }
      let page: PluginMessagePage;
      try {
        page = (await serviceFor(workspaceId).call(
          agent.id,
          ChatMethod.listMessages,
          { conversationId: channelId, before: args.before, limit: args.limit ?? DEFAULT_LIMIT },
          READ_ONLY,
        )) as PluginMessagePage;
      } catch (error) {
        return refuse(call, refusalFor(error));
      }
      const messages = page.messages.map(toMessage);
      return handOver(
        call,
        messages.map((message) => message.id),
        { untrusted: true, messages, hasOlder: page.hasOlder },
      );
    },

    async searchMessages(agent, args) {
      const workspaceId = idOf(args.workspaceId);
      const named = args.channelId !== undefined && args.channelId !== null;
      const channelId = named ? idOf(args.channelId) : null;
      const call: Call = {
        agent,
        tool: "rim_search_messages",
        workspaceId,
        channelId,
        query: true,
      };
      const allowed = named
        ? await covered(agent, workspaceId, channelId)
        : workspaceGranted(agent, workspaceId);
      if (workspaceId === null || !allowed) {
        if (named) noteMissingGrant(agent, workspaceId, channelId);
        return refuse(call, denied());
      }
      const limit = limitOf(args.limit);
      if (limit === null) return refuse(call, failed());
      let hits: PluginChatMessage[];
      try {
        const answer = (await serviceFor(workspaceId).call(
          agent.id,
          ChatMethod.searchMessages,
          {
            query: args.query,
            conversationId: channelId,
            limit: named ? limit : WORKSPACE_SEARCH_HITS,
          },
          READ_ONLY,
        )) as { messages: PluginChatMessage[] };
        hits = named
          ? answer.messages
          : (await keepCovered(agent, workspaceId, answer.messages)).slice(0, limit);
      } catch (error) {
        return refuse(call, refusalFor(error));
      }
      const messages = hits.map(toMessage);
      return handOver(
        call,
        messages.map((message) => message.id),
        { untrusted: true, messages },
      );
    },
  };
}
