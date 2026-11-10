/**
 * One session with an agent program RIM started: the run, the ACP session over it, and what the
 * person sees of it, kept as a snapshot that changes as the agent works. Only the person's own
 * calls of {@link AgentSession.prompt} become prompts, and only {@link
 * AgentSession.answerPermission} answers the agent's permission requests.
 */

import { agentBridgeStatus, type AgentBridgeStatus } from "../api/agentBridge";
import type { AgentProgramProfile } from "../state/useAgentProgramsStore";
import {
  AcpClient,
  mergeToolCall,
  type AcpHttpMcpServer,
  type AgentCommand,
  type AgentHello,
  type ContentBlock,
  type PermissionOption,
  type PermissionOutcome,
  type PermissionRequest,
  type PlanEntry,
  type SessionMode,
  type SessionUpdate,
  type StopReason,
  type ToolCall,
} from "./acpClient";
import {
  AcpRemoteError,
  AcpRunEndedError,
  openAcpConnection,
  type AcpConnection,
} from "./acpConnection";
import { findPreset } from "./acpPresets";

/** Where a session is. */
export type AgentSessionStatus = "starting" | "ready" | "working" | "waiting" | "ended" | "failed";

/**
 * Whether the agent has RIM's tools in this session: `bridge_off` when agents may not connect
 * to RIM, `agent_cannot` when the agent cannot reach an MCP server over HTTP.
 */
export type RimToolsState = "available" | "bridge_off" | "agent_cannot";

/** One entry of a session's transcript, in the order things happened. */
export type TranscriptItem =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "agent_message" | "thought";
      id: string;
      /** The agent's message id, or `null` when it sends none. */
      messageId: string | null;
      /** The message's content, adjacent text chunks joined into one block. */
      content: ContentBlock[];
    }
  | { kind: "tool_call"; id: string; call: ToolCall }
  | { kind: "plan"; id: string; entries: PlanEntry[] }
  | { kind: "notice"; id: string; tone: "info" | "error"; text: string };

/** A permission request waiting for the person. */
export interface PendingPermission {
  /** RIM's id for this request, which {@link AgentSession.answerPermission} takes. */
  requestId: string;
  /** The tool call it is about, merged with what the request said of it. */
  toolCall: ToolCall;
  options: PermissionOption[];
}

/** Everything the person sees of a session. Replaced, never changed, on every change. */
export interface AgentSessionSnapshot {
  status: AgentSessionStatus;
  /** The profile the session runs, or `null` before it starts. */
  profileId: string | null;
  /** What the person calls the agent. */
  name: string;
  /** The session's folder. */
  cwd: string | null;
  /** The ACP session id, once the agent opened it. */
  sessionId: string | null;
  /** What the agent said about itself, once it did. */
  agent: AgentHello | null;
  transcript: readonly TranscriptItem[];
  pendingPermissions: readonly PendingPermission[];
  modes: readonly SessionMode[];
  currentModeId: string | null;
  /** The agent's slash commands. */
  commands: readonly AgentCommand[];
  /** Whether RIM's tools are in the session, once it opened. */
  rimTools: RimToolsState | null;
  /** Why the session failed, as a sentence. */
  error: string | null;
  /** The last lines the program wrote to stderr, when it ended. */
  stderrTail: readonly string[];
}

/** What a session reaches outside itself; tests replace these. */
export interface AgentSessionDeps {
  openConnection: typeof openAcpConnection;
  bridgeStatus: () => Promise<AgentBridgeStatus>;
}

/** What starting a session needs. */
export interface StartAgentSession {
  profile: AgentProgramProfile;
  /** The session's folder, a full path. */
  cwd: string;
}

const DEFAULT_DEPS: AgentSessionDeps = {
  openConnection: openAcpConnection,
  bridgeStatus: agentBridgeStatus,
};

const INITIAL: AgentSessionSnapshot = {
  status: "starting",
  profileId: null,
  name: "",
  cwd: null,
  sessionId: null,
  agent: null,
  transcript: [],
  pendingPermissions: [],
  modes: [],
  currentModeId: null,
  commands: [],
  rimTools: null,
  error: null,
  stderrTail: [],
};

/** Why a profile stored without its program's full path cannot start. */
export const ADD_AGAIN =
  "RIM can't tell which program to start. Remove this agent and add it again.";

/** The JSON-RPC code an agent answers `session/new` with when it needs signing in. */
const AUTH_REQUIRED = -32000;

const STOP_NOTICES: Partial<Record<StopReason, string>> = {
  cancelled: "Stopped.",
  max_tokens: "The agent reached its output limit for this turn.",
  max_turn_requests: "The agent reached its limit of requests for this turn.",
  refusal: "The agent refused to go on with this turn.",
};

interface Waiting {
  view: PendingPermission;
  resolve: (outcome: PermissionOutcome) => void;
}

/** A session with one agent program. */
export class AgentSession {
  private snapshot: AgentSessionSnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly deps: AgentSessionDeps;
  private connection: AcpConnection | null = null;
  private client: AcpClient | null = null;
  private stopping = false;
  private started = false;
  private nextItem = 0;
  private nextPermission = 0;
  /** Where the current turn starts in the transcript. */
  private turnStart = 0;
  private readonly waiting = new Map<string, Waiting>();

  constructor(deps: Partial<AgentSessionDeps> = {}) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  /** The current snapshot. */
  getSnapshot(): AgentSessionSnapshot {
    return this.snapshot;
  }

  get status(): AgentSessionStatus {
    return this.snapshot.status;
  }

  get transcript(): readonly TranscriptItem[] {
    return this.snapshot.transcript;
  }

  get pendingPermissions(): readonly PendingPermission[] {
    return this.snapshot.pendingPermissions;
  }

  get modes(): readonly SessionMode[] {
    return this.snapshot.modes;
  }

  get currentModeId(): string | null {
    return this.snapshot.currentModeId;
  }

  get rimTools(): RimToolsState | null {
    return this.snapshot.rimTools;
  }

  /**
   * Hears every change of the snapshot.
   *
   * @returns A function that stops listening.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Starts the profile's program in `cwd`, introduces RIM and opens a session, with RIM's tools
   * when agents may connect and the agent can reach them. Resolves once the session is `ready`,
   * or `failed` with the reason in `error`; it does not reject.
   */
  async start({ profile, cwd }: StartAgentSession): Promise<void> {
    if (this.started) throw new Error("This session has already started.");
    this.started = true;
    this.change({ status: "starting", profileId: profile.id, name: profile.name, cwd });
    const { token, resolvedProgram } = profile;
    try {
      if (resolvedProgram === null) throw new Error(ADD_AGAIN);
      const bridge = await this.deps.bridgeStatus().catch(() => null);
      const connection = await this.deps.openConnection({
        program: resolvedProgram,
        args: profile.args,
        cwd,
      });
      this.connection = connection;
      const client = new AcpClient(connection, {
        onUpdate: (sessionId, update) => this.hear(sessionId, update),
        onPermission: (request) => this.ask(request),
      });
      this.client = client;
      connection.onEnd((end) => this.ended(end));
      if (this.stopping) return void (await connection.stop());
      const hello = await client.initialize();
      this.change({ agent: hello });
      const canHttp = hello.agentCapabilities.mcpCapabilities.http;
      const bridgeOn = bridge !== null && bridge.enabled && bridge.listening;
      const rimTools: RimToolsState = !canHttp
        ? "agent_cannot"
        : bridgeOn
          ? "available"
          : "bridge_off";
      const mcpServers: AcpHttpMcpServer[] =
        rimTools === "available" && bridge
          ? [
              {
                type: "http",
                name: "rim",
                url: `http://127.0.0.1:${bridge.port}/mcp`,
                headers: [{ name: "Authorization", value: `Bearer ${token}` }],
              },
            ]
          : [];
      const opened = await client.newSession({ cwd, mcpServers });
      if (this.isOver()) return;
      this.change({
        status: "ready",
        sessionId: opened.sessionId,
        rimTools,
        modes: opened.modes?.availableModes ?? [],
        currentModeId: opened.modes?.currentModeId ?? null,
      });
    } catch (error) {
      if (this.isOver()) return;
      this.fail(this.startFailure(error, profile));
      await this.connection?.stop().catch(() => {});
    }
  }

  /**
   * Sends what the person wrote as the next prompt and waits for the turn to end.
   *
   * @param text - The person's words; nothing else ever becomes a prompt.
   * @returns Why the turn ended, or `null` when the run ended during it.
   */
  async prompt(text: string): Promise<StopReason | null> {
    const { status, sessionId } = this.snapshot;
    const client = this.client;
    if (status !== "ready" || sessionId === null || client === null) {
      throw new Error("The agent can't take a prompt right now.");
    }
    if (text.trim() === "") throw new Error("Write something for the agent first.");
    this.turnStart = this.snapshot.transcript.length;
    this.change({
      status: "working",
      transcript: [...this.snapshot.transcript, { kind: "user", id: this.itemId(), text }],
    });
    try {
      const reason = await client.prompt(sessionId, [{ type: "text", text }]);
      if (this.isOver()) return null;
      if (reason === "cancelled") this.cancelUnfinishedCalls();
      const notice = STOP_NOTICES[reason];
      if (notice) this.notice("info", notice);
      this.change({ status: "ready" });
      return reason;
    } catch (error) {
      if (this.isOver()) return null;
      this.notice("error", sentence(error, "The agent could not finish this turn."));
      this.change({ status: "ready" });
      return null;
    }
  }

  /** Cancels the turn that is running; its permission requests are answered `cancelled`. */
  async cancel(): Promise<void> {
    const { status, sessionId } = this.snapshot;
    if ((status !== "working" && status !== "waiting") || sessionId === null || !this.client) {
      return;
    }
    for (const waiting of this.waiting.values()) waiting.resolve({ outcome: "cancelled" });
    this.waiting.clear();
    this.syncPending();
    await this.client.cancel(sessionId);
  }

  /** Switches the session to one of the modes the agent offers. */
  async setMode(modeId: string): Promise<void> {
    const { sessionId, modes } = this.snapshot;
    if (sessionId === null || !this.client || this.isOver()) {
      throw new Error("The session is not open.");
    }
    if (!modes.some((mode) => mode.id === modeId)) throw new Error("The agent has no such mode.");
    await this.client.setMode(sessionId, modeId);
    if (!this.isOver()) this.change({ currentModeId: modeId });
  }

  /**
   * Answers a waiting permission request with one of its options, or `cancelled`.
   *
   * @param requestId - The request, as {@link PendingPermission.requestId} names it.
   */
  answerPermission(requestId: string, outcome: PermissionOutcome): void {
    const waiting = this.waiting.get(requestId);
    if (!waiting) throw new Error("That request no longer needs an answer.");
    if (
      outcome.outcome === "selected" &&
      !waiting.view.options.some((option) => option.optionId === outcome.optionId)
    ) {
      throw new Error("The agent did not offer that answer.");
    }
    this.waiting.delete(requestId);
    waiting.resolve(outcome);
    this.syncPending();
  }

  /** Stops the program. Resolves once it has ended. */
  async stop(): Promise<void> {
    if (this.isOver()) return;
    this.stopping = true;
    for (const waiting of this.waiting.values()) waiting.resolve({ outcome: "cancelled" });
    this.waiting.clear();
    this.syncPending();
    if (this.connection) await this.connection.stop();
    if (!this.isOver()) this.change({ status: "ended" });
  }

  private isOver(): boolean {
    return this.snapshot.status === "ended" || this.snapshot.status === "failed";
  }

  private change(changes: Partial<AgentSessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of [...this.listeners]) listener();
  }

  private itemId(): string {
    return `item-${this.nextItem++}`;
  }

  private notice(tone: "info" | "error", text: string): void {
    this.change({
      transcript: [...this.snapshot.transcript, { kind: "notice", id: this.itemId(), tone, text }],
    });
  }

  private fail(error: string): void {
    this.waiting.clear();
    this.change({ status: "failed", error, pendingPermissions: [] });
  }

  private startFailure(error: unknown, profile: AgentProgramProfile): string {
    if (error instanceof AcpRemoteError && error.code === AUTH_REQUIRED) {
      const preset = findPreset(profile.presetId);
      return preset
        ? `${profile.name} needs you to sign in first. ${preset.signIn.text}`
        : `${profile.name} needs you to sign in first, in its own way.`;
    }
    return sentence(error, "The agent could not be started.");
  }

  private ended(end: AcpRunEndedError): void {
    if (this.isOver()) return;
    this.waiting.clear();
    const stderrTail = end.stderrTail;
    if (this.stopping || (end.reason === null && end.code === 0)) {
      this.change({ status: "ended", pendingPermissions: [], stderrTail });
      return;
    }
    this.change({ stderrTail });
    this.fail(end.message);
  }

  private hear(sessionId: string, update: SessionUpdate): void {
    if (sessionId !== this.snapshot.sessionId && this.snapshot.status !== "starting") return;
    switch (update.kind) {
      case "user_message_chunk":
        return this.appendChunk("user", update.content, update.messageId);
      case "agent_message_chunk":
        return this.appendChunk("agent_message", update.content, update.messageId);
      case "agent_thought_chunk":
        return this.appendChunk("thought", update.content, update.messageId);
      case "tool_call":
      case "tool_call_update":
        this.mergeCall(update.kind === "tool_call" ? update.toolCall : update.patch);
        return;
      case "plan":
        return this.setPlan(update.entries);
      case "available_commands_update":
        return this.change({ commands: update.commands });
      case "current_mode_update":
        if (this.snapshot.modes.some((mode) => mode.id === update.currentModeId)) {
          this.change({ currentModeId: update.currentModeId });
        }
        return;
      case "session_info_update":
      case "unknown":
        return;
    }
  }

  /** Adds a chunk to the last message of the same kind and id, or starts a new message. */
  private appendChunk(
    kind: "user" | "agent_message" | "thought",
    content: ContentBlock,
    messageId: string | null,
  ): void {
    const transcript = [...this.snapshot.transcript];
    const last = transcript[transcript.length - 1];
    if (kind === "user") {
      // Only a session the agent replays has user chunks: they show what was asked before.
      const added = content.type === "text" ? content.text : "";
      if (last?.kind === "user")
        transcript[transcript.length - 1] = { ...last, text: last.text + added };
      else transcript.push({ kind: "user", id: this.itemId(), text: added });
      return this.change({ transcript });
    }
    if (last && last.kind === kind && last.messageId === messageId) {
      transcript[transcript.length - 1] = { ...last, content: joinContent(last.content, content) };
    } else {
      transcript.push({ kind, id: this.itemId(), messageId, content: [content] });
    }
    this.change({ transcript });
  }

  private mergeCall(patch: Partial<ToolCall> & { toolCallId: string }): ToolCall {
    const transcript = [...this.snapshot.transcript];
    const index = transcript.findIndex(
      (item) => item.kind === "tool_call" && item.call.toolCallId === patch.toolCallId,
    );
    const existing = index >= 0 ? transcript[index] : undefined;
    const call = mergeToolCall(existing?.kind === "tool_call" ? existing.call : undefined, patch);
    if (existing) transcript[index] = { kind: "tool_call", id: existing.id, call };
    else transcript.push({ kind: "tool_call", id: this.itemId(), call });
    const pendingPermissions = this.snapshot.pendingPermissions.map((pending) =>
      pending.toolCall.toolCallId === call.toolCallId ? { ...pending, toolCall: call } : pending,
    );
    this.change({ transcript, pendingPermissions });
    return call;
  }

  /** Replaces the plan of this turn, or adds one when the turn has none. */
  private setPlan(entries: PlanEntry[]): void {
    const transcript = [...this.snapshot.transcript];
    let index = -1;
    for (let i = transcript.length - 1; i >= this.turnStart; i--) {
      if (transcript[i]?.kind === "plan") {
        index = i;
        break;
      }
    }
    if (index >= 0) transcript[index] = { kind: "plan", id: transcript[index].id, entries };
    else transcript.push({ kind: "plan", id: this.itemId(), entries });
    this.change({ transcript });
  }

  private cancelUnfinishedCalls(): void {
    const transcript = this.snapshot.transcript.map((item, index) =>
      index >= this.turnStart &&
      item.kind === "tool_call" &&
      (item.call.status === "pending" || item.call.status === "in_progress")
        ? { ...item, call: { ...item.call, status: "cancelled" as const } }
        : item,
    );
    this.change({ transcript });
  }

  private ask(request: PermissionRequest): Promise<PermissionOutcome> {
    const { status, sessionId } = this.snapshot;
    if (request.sessionId !== sessionId || (status !== "working" && status !== "waiting")) {
      return Promise.resolve({ outcome: "cancelled" });
    }
    const toolCall = this.mergeCall(request.toolCall);
    const requestId = `permission-${this.nextPermission++}`;
    return new Promise<PermissionOutcome>((resolve) => {
      this.waiting.set(requestId, {
        view: { requestId, toolCall, options: request.options },
        resolve,
      });
      request.signal.addEventListener(
        "abort",
        () => {
          if (this.waiting.delete(requestId)) {
            resolve({ outcome: "cancelled" });
            this.syncPending();
          }
        },
        { once: true },
      );
      this.syncPending();
    });
  }

  /** Puts the waiting requests in the snapshot, and the status that goes with them. */
  private syncPending(): void {
    const pendingPermissions = [...this.waiting.values()].map((waiting) => {
      const item = this.snapshot.transcript.find(
        (entry) =>
          entry.kind === "tool_call" && entry.call.toolCallId === waiting.view.toolCall.toolCallId,
      );
      return item?.kind === "tool_call" ? { ...waiting.view, toolCall: item.call } : waiting.view;
    });
    const { status } = this.snapshot;
    const next =
      status === "working" || status === "waiting"
        ? pendingPermissions.length > 0
          ? "waiting"
          : "working"
        : status;
    this.change({ pendingPermissions, status: next });
  }
}

/** Joins `added` to a message's content: text to the text before it, anything else after. */
function joinContent(content: ContentBlock[], added: ContentBlock): ContentBlock[] {
  const last = content[content.length - 1];
  if (last?.type === "text" && added.type === "text") {
    return [...content.slice(0, -1), { type: "text", text: last.text + added.text }];
  }
  return [...content, added];
}

/** The error's own sentence, or `fallback`. */
function sentence(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}
