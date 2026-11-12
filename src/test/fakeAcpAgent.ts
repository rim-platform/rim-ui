/**
 * A stand-in for the agent runner with a scripted ACP agent behind it. A test mocks
 * `agentRunner` with {@link fakeAgentRunnerModule}, answers methods with {@link FakeAcpAgent.on}
 * and sends the agent's own messages with {@link FakeAcpAgent.emit}.
 */

import { vi } from "vitest";

import type { AgentRunExit, AgentRunLine } from "../features/agents/acp/agentRunner";

/** A JSON-RPC message as the fake agent reads or writes it. */
export type FakeMessage = Record<string, unknown>;

/** Answers one request: a result, or `undefined` to leave it waiting. */
export type FakeAnswer = (params: unknown, id: number) => unknown;

/** The scripted agent and the runner it sits behind. */
export class FakeAcpAgent {
  /** Every message the client wrote, parsed, in order. */
  received: FakeMessage[] = [];
  runId = "ar_fake";
  private readonly lineListeners = new Set<(line: AgentRunLine) => void>();
  private readonly exitListeners = new Set<(exit: AgentRunExit) => void>();
  private answers = new Map<string, FakeAnswer>();

  readonly startAgentRun = vi.fn(() => Promise.resolve(this.runId));
  readonly stopAgentRun = vi.fn(() => {
    this.exit({ code: null, signal: 15, reason: "stopped" });
    return Promise.resolve();
  });
  readonly sendAgentLine = vi.fn((_runId: string, line: string) => {
    const message = JSON.parse(line) as FakeMessage;
    this.received.push(message);
    const method = message.method;
    if (typeof method === "string" && typeof message.id === "number") {
      const answer = this.answers.get(method);
      if (answer) {
        const id = message.id;
        const result = answer(message.params, id);
        if (result !== undefined) queueMicrotask(() => this.respond(id, result));
      }
    }
    return Promise.resolve();
  });

  /** Clears what was received, the answers and the listeners. */
  reset(): void {
    this.received = [];
    this.answers = new Map();
    this.lineListeners.clear();
    this.exitListeners.clear();
    this.startAgentRun.mockClear();
    this.stopAgentRun.mockClear();
    this.sendAgentLine.mockClear();
  }

  /** Answers every request for `method` with what `answer` returns. */
  on(method: string, answer: FakeAnswer): this {
    this.answers.set(method, answer);
    return this;
  }

  /** Writes one line as the agent's stdout. */
  emit(message: FakeMessage | string): void {
    const line = typeof message === "string" ? message : JSON.stringify(message);
    for (const listener of [...this.lineListeners]) listener({ runId: this.runId, line });
  }

  /** Answers request `id` with `result`. */
  respond(id: number, result: unknown): void {
    this.emit({ jsonrpc: "2.0", id, result });
  }

  /** Answers request `id` with an error. */
  fail(id: number, code: number, message: string): void {
    this.emit({ jsonrpc: "2.0", id, error: { code, message } });
  }

  /** Sends a `session/update`. */
  update(sessionId: string, update: FakeMessage): void {
    this.emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
  }

  /** Sends a request of the agent's own. */
  ask(id: number | string, method: string, params: unknown): void {
    this.emit({ jsonrpc: "2.0", id, method, params });
  }

  /** Ends the run. */
  exit(exit: Partial<Omit<AgentRunExit, "runId">> = {}): void {
    const ended: AgentRunExit = {
      runId: this.runId,
      code: 0,
      signal: null,
      reason: null,
      stderrTail: [],
      ...exit,
    };
    for (const listener of [...this.exitListeners]) listener(ended);
  }

  /** The requests the client sent for `method`. */
  requests(method: string): FakeMessage[] {
    return this.received.filter((message) => message.method === method);
  }

  /** The `agentRunner` functions an ACP connection uses, backed by this agent. */
  module() {
    return {
      startAgentRun: this.startAgentRun,
      stopAgentRun: this.stopAgentRun,
      sendAgentLine: this.sendAgentLine,
      onAgentRunLine: (callback: (line: AgentRunLine) => void) => {
        this.lineListeners.add(callback);
        return () => this.lineListeners.delete(callback);
      },
      onAgentRunExit: (callback: (exit: AgentRunExit) => void) => {
        this.exitListeners.add(callback);
        return () => this.exitListeners.delete(callback);
      },
    };
  }
}

/** The one fake agent the tests of a file share. */
export const fakeAcpAgent = new FakeAcpAgent();

/** An `initialize` answer of an agent that reaches MCP servers over HTTP unless told otherwise. */
export function helloAnswer(http = true, extra: FakeMessage = {}): FakeMessage {
  return {
    protocolVersion: 1,
    agentCapabilities: { loadSession: true, mcpCapabilities: { http, sse: false }, ...extra },
    agentInfo: { name: "fake-agent", title: "Fake Agent", version: "1.0.0" },
    authMethods: [],
  };
}
