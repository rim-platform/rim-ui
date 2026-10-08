import { PassThrough } from "node:stream";

import type * as wire from "./generated/protocol.ts";
import { ErrorCode, Method, PROTOCOL_VERSION } from "./generated/protocol.ts";
import { encodeFrame, FrameDecoder } from "./framing.ts";
import type { Initiator, Plugin } from "./plugin.ts";

/** What the test host sends in its handshake, and how it answers the plugin. */
export interface TestHostOptions {
  /** The manifest to check the plugin against. Defaults to none (`false`). */
  readonly manifestPath?: string | false;
  /** The signed-in user. Defaults to a provisional principal named "Test User". */
  readonly principal?: wire.Principal | null;
  readonly grantedCapabilities?: string[];
  /** Answers the plugin's own requests. Throw a `wire.Error`-shaped object to fail one. */
  readonly onRequest?: (method: string, params: unknown) => unknown;
  /** How long to wait for each plugin answer. Defaults to 5 seconds. */
  readonly timeoutMs?: number;
}

/** A command answer: exactly one of `result` and `error` is set. */
export interface ExecuteAnswer {
  readonly result?: wire.CommandResult;
  readonly error?: wire.Error;
}

/** Options for {@link TestHost.execute}; the defaults are what the host sends for a palette run. */
export interface ExecuteOptions {
  readonly confirmed?: boolean;
  readonly initiator?: Initiator;
  /** Defaults to the handshake principal. */
  readonly invoker?: wire.Principal | null;
}

/** An in-memory RIM host for testing a plugin without the desktop app. */
export interface TestHost {
  /** Every frame the plugin sent, in order. */
  readonly frames: readonly unknown[];
  /** Every `rim.log` line the plugin sent, in order. */
  readonly logs: readonly wire.LogParams[];
  /** Resolves with the exit code once the plugin has stopped. */
  readonly exited: Promise<number>;
  /** Send `rim.handshake`. `params` overrides fields, including unknown ones. */
  handshake(
    params?: Partial<wire.HandshakeParams> & Record<string, unknown>,
  ): Promise<wire.HandshakeResult>;
  /** Send `rim.command.execute`, as the host does after its own checks. */
  execute(
    commandId: string,
    args?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<ExecuteAnswer>;
  /** Send `rim.heartbeat` and return its result. */
  heartbeat(): Promise<unknown>;
  /** Send any request and return the plugin's whole response frame. */
  request(method: string, params?: unknown): Promise<Record<string, unknown>>;
  /** Send a notification. */
  notify(method: string, params?: unknown): void;
  /** Send `rim.shutdown` and wait for the plugin to stop. */
  shutdown(): Promise<number>;
  /** Close the plugin's input, as the host does after `rim.shutdown`. */
  close(): void;
}

/** The principal the test host signs in as, unless told otherwise. */
export const TEST_PRINCIPAL: wire.Principal = Object.freeze({
  principalId: "rimp0_test-principal",
  displayName: "Test User",
});

/**
 * Start `plugin` against an in-memory host.
 *
 * @example
 * const host = startTestHost(plugin);
 * await host.handshake();
 * expect(await host.execute("greet")).toEqual({ result: { payload: "Hello, Test User!" } });
 * await host.shutdown();
 */
export function startTestHost(plugin: Plugin, options: TestHostOptions = {}): TestHost {
  const input = new PassThrough();
  const output = new PassThrough();
  const decoder = new FrameDecoder();
  const frames: unknown[] = [];
  const logs: wire.LogParams[] = [];
  const waiting = new Map<wire.Id, (frame: Record<string, unknown>) => void>();
  const timeoutMs = options.timeoutMs ?? 5_000;
  const principal = options.principal === undefined ? TEST_PRINCIPAL : options.principal;
  let nextId = 1;
  let nextHeartbeat = -1;

  let exitCode: (code: number) => void = () => {};
  const exited = new Promise<number>((done) => {
    exitCode = done;
  });

  const send = (frame: unknown) => {
    if (!input.writableEnded) input.write(encodeFrame(frame));
  };

  output.on("data", (chunk: Uint8Array) => {
    for (const decoded of decoder.push(chunk)) {
      if (!decoded.ok) {
        frames.push({ invalidFrame: decoded.error });
        continue;
      }
      const frame = decoded.value as Record<string, unknown>;
      frames.push(frame);
      if (typeof frame.method === "string") {
        if (frame.method === Method.log) logs.push(frame.params as wire.LogParams);
        if (frame.id !== undefined && frame.id !== null) void answer(frame);
      } else if (waiting.has(frame.id as wire.Id)) {
        waiting.get(frame.id as wire.Id)?.(frame);
        waiting.delete(frame.id as wire.Id);
      }
    }
  });

  const answer = async (frame: Record<string, unknown>) => {
    const id = frame.id;
    if (frame.method === Method.log) {
      send({ jsonrpc: "2.0", id, result: { ok: true } });
      return;
    }
    if (!options.onRequest) {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: ErrorCode.METHOD_NOT_FOUND, message: `method not found: ${frame.method}` },
      });
      return;
    }
    try {
      send({
        jsonrpc: "2.0",
        id,
        result: await options.onRequest(String(frame.method), frame.params),
      });
    } catch (error) {
      const e = error as Partial<wire.Error>;
      const code = typeof e.code === "number" ? e.code : ErrorCode.INTERNAL_ERROR;
      send({ jsonrpc: "2.0", id, error: { code, message: String(e.message ?? error) } });
    }
  };

  const request = (method: string, params?: unknown, id: wire.Id = nextId++) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`plugin did not answer ${method} within ${timeoutMs} ms`));
      }, timeoutMs);
      waiting.set(id, (frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
      send(
        params === undefined
          ? { jsonrpc: "2.0", id, method }
          : { jsonrpc: "2.0", id, method, params },
      );
    });

  void plugin
    .run({
      input,
      output,
      manifestPath: options.manifestPath ?? false,
      exit: (code) => exitCode(code),
    })
    .catch(() => exitCode(-1));

  return {
    frames,
    logs,
    exited,
    async handshake(params = {}) {
      const response = await request(Method.handshake, {
        protocolVersion: PROTOCOL_VERSION,
        supportedVersions: [PROTOCOL_VERSION],
        pluginId: plugin.id,
        hostVersion: "0.0.0-test",
        grantedCapabilities: options.grantedCapabilities ?? [],
        principal,
        ...params,
      });
      return response.result as wire.HandshakeResult;
    },
    async execute(commandId, args = {}, executeOptions = {}) {
      const params: wire.CommandExecuteParams = {
        commandId,
        args,
        invoker: executeOptions.invoker === undefined ? principal : executeOptions.invoker,
        initiator: executeOptions.initiator ?? "user",
        confirmed: executeOptions.confirmed ?? false,
      };
      const response = await request(Method.commandExecute, params);
      return response.error !== undefined
        ? { error: response.error as wire.Error }
        : { result: response.result as wire.CommandResult };
    },
    async heartbeat() {
      return (await request(Method.heartbeat, undefined, nextHeartbeat--)).result;
    },
    request,
    notify(method, params) {
      send(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params });
    },
    async shutdown() {
      send({ jsonrpc: "2.0", method: Method.shutdown });
      input.end();
      return exited;
    },
    close() {
      input.end();
    },
  };
}
