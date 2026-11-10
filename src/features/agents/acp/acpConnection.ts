/**
 * A JSON-RPC 2.0 peer over one agent run: one message per line on the run's stdin and stdout, as
 * the Agent Client Protocol carries it. It sends requests and notifications, matches responses
 * to requests, hands notifications to listeners and answers the agent's own requests. Every line
 * the agent writes is untrusted: what is not a JSON-RPC message is counted and dropped.
 */

import {
  onAgentRunExit,
  onAgentRunLine,
  sendAgentLine,
  startAgentRun,
  stopAgentRun,
  type AgentRunExit,
  type StartAgentRunOptions,
} from "./agentRunner";

/** Any JSON value. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** The method is not one this side offers. */
export const METHOD_NOT_FOUND = -32601;
/** The answering side failed while answering. */
export const INTERNAL_ERROR = -32603;
/** The asking side cancelled the request. */
export const REQUEST_CANCELLED = -32800;

/** How many lines a run may write before its id is known; later ones are dropped. */
const EARLY_LIMIT = 1000;

/** An error the agent answered a request with. */
export class AcpRemoteError extends Error {
  /** The JSON-RPC error code. */
  readonly code: number;
  /** The error's `data`, as the agent sent it. */
  readonly data: JsonValue | undefined;

  constructor(code: number, message: string, data: JsonValue | undefined) {
    super(message);
    this.name = "AcpRemoteError";
    this.code = code;
    this.data = data;
  }
}

/** A request the agent did not answer in time. */
export class AcpTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`The agent did not answer ${method} within ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = "AcpTimeoutError";
  }
}

/** How the run ended, as each request still waiting is rejected with. */
export class AcpRunEndedError extends Error {
  /** Why the runner ended it, or `null` when the program exited by itself. */
  readonly reason: AgentRunExit["reason"];
  readonly code: number | null;
  readonly signal: number | null;
  /** The last lines of its stderr, oldest first. */
  readonly stderrTail: string[];

  constructor(exit: AgentRunExit) {
    super(endSentence(exit));
    this.name = "AcpRunEndedError";
    this.reason = exit.reason;
    this.code = exit.code;
    this.signal = exit.signal;
    this.stderrTail = [...exit.stderrTail];
  }
}

/** A plain sentence for how a run ended. */
function endSentence(exit: AgentRunExit): string {
  switch (exit.reason) {
    case "stopped":
      return "The agent program was stopped.";
    case "line_too_long":
      return "The agent program wrote a line too long to read, so RIM stopped it.";
    case "stdout_failed":
      return "RIM could not read the agent program's output, so it stopped it.";
    default:
      if (exit.code !== null) return `The agent program ended with exit code ${exit.code}.`;
      if (exit.signal !== null) return `The agent program was ended by signal ${exit.signal}.`;
      return "The agent program ended.";
  }
}

/** Options of one request. */
export interface AcpRequestOptions {
  /** How long to wait for the answer; no limit when left out. */
  timeoutMs?: number;
}

/**
 * Answers one request from the agent.
 *
 * @param params - The request's params as the agent sent them, untrusted.
 * @param signal - Aborts when the agent cancels the request.
 * @returns The result to answer with.
 */
export type AcpRequestHandler = (
  params: JsonValue | undefined,
  signal: AbortSignal,
) => Promise<JsonValue>;

/** Hears one notification from the agent, its params untrusted. */
export type AcpNotificationListener = (method: string, params: JsonValue | undefined) => void;

interface Pending {
  method: string;
  resolve: (result: JsonValue) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** An object that came from JSON, as a record of untrusted values. */
type JsonObject = { [key: string]: JsonValue };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value of an own property of `object`, or `undefined`. */
function own(object: JsonObject, key: string): JsonValue | undefined {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
}

/** One JSON-RPC 2.0 peer over a running agent program. */
export class AcpConnection {
  /** The run this connection talks to. */
  readonly runId: string;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, AcpRequestHandler>();
  private readonly inbound = new Map<string, AbortController>();
  private readonly notificationListeners = new Set<AcpNotificationListener>();
  private readonly endListeners = new Set<(error: AcpRunEndedError) => void>();
  private endedWith: AcpRunEndedError | null = null;
  private dropped = 0;
  private unsubscribe: (() => void) | null;

  /** Use {@link openAcpConnection}, which subscribes before the run starts. */
  constructor(runId: string, unsubscribe: () => void) {
    this.runId = runId;
    this.unsubscribe = unsubscribe;
  }

  /** How many lines from the agent were not JSON-RPC messages and were dropped. */
  get droppedLines(): number {
    return this.dropped;
  }

  /** How the run ended, or `null` while it runs. */
  get ended(): AcpRunEndedError | null {
    return this.endedWith;
  }

  /**
   * Sends a request and waits for its answer.
   *
   * @param method - The method.
   * @param params - Its params.
   * @param options - How long to wait.
   * @returns The answer's `result`, untrusted. Rejects with {@link AcpRemoteError} when the agent
   *   answers with an error, {@link AcpTimeoutError} when it does not answer in time,
   *   {@link AcpRunEndedError} when the run ends first, or the runner's error when the line
   *   could not be written.
   */
  request(method: string, params: JsonValue, options: AcpRequestOptions = {}): Promise<JsonValue> {
    if (this.endedWith) return Promise.reject(this.endedWith);
    const id = this.nextId++;
    return new Promise<JsonValue>((resolve, reject) => {
      const entry: Pending = { method, resolve, reject, timer: null };
      if (options.timeoutMs !== undefined) {
        const timeoutMs = options.timeoutMs;
        entry.timer = setTimeout(() => {
          if (this.pending.get(id) !== entry) return;
          this.pending.delete(id);
          reject(new AcpTimeoutError(method, timeoutMs));
        }, timeoutMs);
      }
      this.pending.set(id, entry);
      this.write({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => {
        if (this.pending.get(id) !== entry) return;
        this.settle(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  /**
   * Sends a notification, which has no answer.
   *
   * @param method - The method.
   * @param params - Its params.
   */
  async notify(method: string, params: JsonValue): Promise<void> {
    if (this.endedWith) throw this.endedWith;
    await this.write({ jsonrpc: "2.0", method, params });
  }

  /**
   * Answers the agent's requests for `method` with `handler`. Requests for a method without a
   * handler are answered with {@link METHOD_NOT_FOUND}.
   */
  handle(method: string, handler: AcpRequestHandler): void {
    this.handlers.set(method, handler);
  }

  /**
   * Hears every notification from the agent.
   *
   * @returns A function that stops listening.
   */
  onNotification(listener: AcpNotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  /**
   * Hears the run end, once, after every waiting request was rejected. A listener added after
   * the end is called at once.
   *
   * @returns A function that stops listening.
   */
  onEnd(listener: (error: AcpRunEndedError) => void): () => void {
    if (this.endedWith) {
      listener(this.endedWith);
      return () => {};
    }
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  /** Stops the run; resolves once it has ended. */
  stop(): Promise<void> {
    return stopAgentRun(this.runId);
  }

  /** Takes one line of the run's stdout. */
  receiveLine(line: string): void {
    if (this.endedWith) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.dropped++;
      return;
    }
    if (!isObject(message) || own(message, "jsonrpc") !== "2.0") {
      this.dropped++;
      return;
    }
    const method = own(message, "method");
    const id = own(message, "id");
    const hasId = typeof id === "number" || typeof id === "string";
    if (typeof method === "string") {
      if (hasId) this.answerRequest(id, method, own(message, "params"));
      else if (own(message, "id") === undefined)
        this.hearNotification(method, own(message, "params"));
      else this.dropped++;
      return;
    }
    if (typeof id !== "number" || !this.pending.has(id)) {
      this.dropped++;
      return;
    }
    const error = own(message, "error");
    if (isObject(error)) {
      const code = own(error, "code");
      const text = own(error, "message");
      this.settle(id)?.reject(
        new AcpRemoteError(
          typeof code === "number" ? code : INTERNAL_ERROR,
          typeof text === "string" && text !== "" ? text : "The agent answered with an error.",
          own(error, "data"),
        ),
      );
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(message, "result")) {
      this.dropped++;
      return;
    }
    this.settle(id)?.resolve(own(message, "result") ?? null);
  }

  /** Takes the run's end: rejects every waiting request and stops listening. */
  receiveExit(exit: AgentRunExit): void {
    if (this.endedWith) return;
    const error = new AcpRunEndedError(exit);
    this.endedWith = error;
    for (const id of [...this.pending.keys()]) this.settle(id)?.reject(error);
    for (const controller of this.inbound.values()) controller.abort();
    this.inbound.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const listener of [...this.endListeners]) listener(error);
    this.endListeners.clear();
  }

  /** Removes a waiting request and its timer, and returns it. */
  private settle(id: number): Pending | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    this.pending.delete(id);
    if (entry.timer !== null) clearTimeout(entry.timer);
    return entry;
  }

  private write(message: JsonObject): Promise<void> {
    return sendAgentLine(this.runId, JSON.stringify(message));
  }

  private hearNotification(method: string, params: JsonValue | undefined): void {
    if (method === "$/cancel_request") {
      const requestId = isObject(params) ? own(params, "requestId") : undefined;
      if (typeof requestId === "number" || typeof requestId === "string") {
        this.inbound.get(inboundKey(requestId))?.abort();
      }
      return;
    }
    for (const listener of [...this.notificationListeners]) listener(method, params);
  }

  private answerRequest(id: number | string, method: string, params: JsonValue | undefined): void {
    const handler = this.handlers.get(method);
    if (!handler) {
      this.reply(id, { error: { code: METHOD_NOT_FOUND, message: "Method not found" } });
      return;
    }
    const key = inboundKey(id);
    this.inbound.get(key)?.abort();
    const controller = new AbortController();
    this.inbound.set(key, controller);
    let answer: Promise<JsonValue>;
    try {
      answer = handler(params, controller.signal);
    } catch (error) {
      answer = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    answer
      .then(
        (result): JsonObject => (controller.signal.aborted ? CANCELLED_ANSWER : { result }),
        (): JsonObject =>
          controller.signal.aborted
            ? CANCELLED_ANSWER
            : { error: { code: INTERNAL_ERROR, message: "Internal error" } },
      )
      .then((reply) => {
        if (this.inbound.get(key) !== controller && !controller.signal.aborted) return;
        if (this.inbound.get(key) === controller) this.inbound.delete(key);
        this.reply(id, reply);
      });
  }

  private reply(id: number | string, body: JsonObject): void {
    if (this.endedWith) return;
    this.write({ jsonrpc: "2.0", id, ...body }).catch(() => {
      // The run is ending; its end reaches every listener.
    });
  }
}

const CANCELLED_ANSWER: JsonObject = {
  error: { code: REQUEST_CANCELLED, message: "Request cancelled" },
};

/** Keeps numeric and string request ids apart. */
function inboundKey(id: number | string): string {
  return `${typeof id}:${id}`;
}

/**
 * Starts an agent run and the connection over it. It listens before the run starts, so nothing
 * the run writes or how it ends is missed.
 *
 * @param options - The program, its arguments and its working folder.
 * @returns The connection. Rejects with the runner's error when the run does not start.
 */
export async function openAcpConnection(options: StartAgentRunOptions): Promise<AcpConnection> {
  let connection: AcpConnection | null = null;
  const early: ({ line: string; runId: string } | AgentRunExit)[] = [];
  const stopLines = onAgentRunLine((event) => {
    if (connection) {
      if (event.runId === connection.runId) connection.receiveLine(event.line);
    } else if (early.length < EARLY_LIMIT) early.push(event);
  });
  const stopExits = onAgentRunExit((exit) => {
    if (connection) {
      if (exit.runId === connection.runId) connection.receiveExit(exit);
    } else early.push(exit);
  });
  const unsubscribe = () => {
    stopLines();
    stopExits();
  };
  let runId: string;
  try {
    runId = await startAgentRun(options);
  } catch (error) {
    unsubscribe();
    throw error;
  }
  const opened = new AcpConnection(runId, unsubscribe);
  connection = opened;
  for (const event of early) {
    if (event.runId !== runId) continue;
    if ("line" in event) opened.receiveLine(event.line);
    else opened.receiveExit(event);
  }
  return opened;
}
