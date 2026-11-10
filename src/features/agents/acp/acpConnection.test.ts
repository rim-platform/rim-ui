import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({
  lines: new Set<(event: { runId: string; line: string }) => void>(),
  exits: new Set<(exit: unknown) => void>(),
  sent: [] as { runId: string; line: string }[],
  startAgentRun: vi.fn(),
  stopAgentRun: vi.fn(),
  sendAgentLine: vi.fn(),
}));
vi.mock("./agentRunner", () => ({
  startAgentRun: runner.startAgentRun,
  stopAgentRun: runner.stopAgentRun,
  sendAgentLine: runner.sendAgentLine,
  onAgentRunLine: (callback: (event: { runId: string; line: string }) => void) => {
    runner.lines.add(callback);
    return () => runner.lines.delete(callback);
  },
  onAgentRunExit: (callback: (exit: unknown) => void) => {
    runner.exits.add(callback);
    return () => runner.exits.delete(callback);
  },
}));

import {
  AcpRemoteError,
  AcpRunEndedError,
  AcpTimeoutError,
  METHOD_NOT_FOUND,
  REQUEST_CANCELLED,
  openAcpConnection,
} from "./acpConnection";

function emit(line: unknown, runId = "ar_1") {
  const text = typeof line === "string" ? line : JSON.stringify(line);
  for (const listener of [...runner.lines]) listener({ runId, line: text });
}

function exit(runId = "ar_1", extra: Record<string, unknown> = {}) {
  for (const listener of [...runner.exits]) {
    listener({ runId, code: 1, signal: null, reason: null, stderrTail: ["boom"], ...extra });
  }
}

function sent(): Record<string, unknown>[] {
  return runner.sent.map((entry) => JSON.parse(entry.line) as Record<string, unknown>);
}

const START = { program: "fake-agent", args: [], cwd: "/home/a/project" };

describe("acpConnection", () => {
  beforeEach(() => {
    runner.lines.clear();
    runner.exits.clear();
    runner.sent = [];
    runner.startAgentRun.mockReset().mockResolvedValue("ar_1");
    runner.stopAgentRun.mockReset().mockResolvedValue(undefined);
    runner.sendAgentLine.mockReset().mockImplementation((runId: string, line: string) => {
      runner.sent.push({ runId, line });
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a request on one line and resolves with its result", async () => {
    const connection = await openAcpConnection(START);
    const answer = connection.request("initialize", { protocolVersion: 1 });
    await Promise.resolve();
    expect(runner.sent).toHaveLength(1);
    expect(runner.sent[0].runId).toBe("ar_1");
    expect(runner.sent[0].line).not.toContain("\n");
    expect(sent()[0]).toEqual({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: 1 },
    });
    emit({ jsonrpc: "2.0", id: 0, result: { protocolVersion: 1 } });
    await expect(answer).resolves.toEqual({ protocolVersion: 1 });
  });

  it("numbers requests and matches each answer to its own", async () => {
    const connection = await openAcpConnection(START);
    const first = connection.request("a", {});
    const second = connection.request("b", {});
    await Promise.resolve();
    expect(sent().map((message) => message.id)).toEqual([0, 1]);
    emit({ jsonrpc: "2.0", id: 1, result: "second" });
    emit({ jsonrpc: "2.0", id: 0, result: "first" });
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });

  it("rejects with the agent's error", async () => {
    const connection = await openAcpConnection(START);
    const answer = connection.request("session/new", {});
    emit({ jsonrpc: "2.0", id: 0, error: { code: -32000, message: "Authentication required" } });
    const error = await answer.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AcpRemoteError);
    expect((error as AcpRemoteError).code).toBe(-32000);
    expect((error as AcpRemoteError).message).toBe("Authentication required");
  });

  it("gives up on a request that is not answered in time", async () => {
    vi.useFakeTimers();
    const connection = await openAcpConnection(START);
    const answer = connection.request("initialize", {}, { timeoutMs: 60_000 });
    const settled = answer.catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(59_999);
    emit({ jsonrpc: "2.0", id: 5, result: null });
    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;
    expect(error).toBeInstanceOf(AcpTimeoutError);
    expect((error as Error).message).toBe("The agent did not answer initialize within 60 seconds.");
    emit({ jsonrpc: "2.0", id: 0, result: "late" });
    expect(connection.droppedLines).toBe(2);
  });

  it("waits for a request without a timeout as long as it takes", async () => {
    vi.useFakeTimers();
    const connection = await openAcpConnection(START);
    const answer = connection.request("session/prompt", {});
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    emit({ jsonrpc: "2.0", id: 0, result: { stopReason: "end_turn" } });
    await expect(answer).resolves.toEqual({ stopReason: "end_turn" });
  });

  it("counts and drops lines that are not JSON-RPC, without throwing", async () => {
    const connection = await openAcpConnection(START);
    const heard = vi.fn();
    connection.onNotification(heard);
    expect(() => {
      emit("Starting the agent…");
      emit("{not json");
      emit({ id: 0, result: 1 });
      emit([{ jsonrpc: "2.0", method: "x" }]);
      emit({ jsonrpc: "2.0", id: 99, result: 1 });
      emit({ jsonrpc: "2.0", id: null, method: "x" });
      emit("null");
    }).not.toThrow();
    expect(connection.droppedLines).toBe(7);
    expect(heard).not.toHaveBeenCalled();
  });

  it("ignores another run's lines", async () => {
    const connection = await openAcpConnection(START);
    const heard = vi.fn();
    connection.onNotification(heard);
    emit({ jsonrpc: "2.0", method: "session/update", params: {} }, "ar_other");
    expect(heard).not.toHaveBeenCalled();
    emit({ jsonrpc: "2.0", method: "session/update", params: { a: 1 } });
    expect(heard).toHaveBeenCalledWith("session/update", { a: 1 });
  });

  it("answers fs and terminal requests, and any it does not offer, with method not found", async () => {
    await openAcpConnection(START);
    emit({ jsonrpc: "2.0", id: 7, method: "fs/read_text_file", params: { path: "/etc/passwd" } });
    emit({ jsonrpc: "2.0", id: "t1", method: "terminal/create", params: { command: "rm" } });
    await vi.waitFor(() => expect(runner.sent).toHaveLength(2));
    expect(sent()).toEqual([
      { jsonrpc: "2.0", id: 7, error: { code: METHOD_NOT_FOUND, message: "Method not found" } },
      { jsonrpc: "2.0", id: "t1", error: { code: METHOD_NOT_FOUND, message: "Method not found" } },
    ]);
  });

  it("answers a request with its handler, or cancelled when the agent withdraws it", async () => {
    const connection = await openAcpConnection(START);
    connection.handle(
      "session/request_permission",
      (_params, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve("ignored"));
        }),
    );
    connection.handle("echo", (params) => Promise.resolve(params ?? null));
    emit({ jsonrpc: "2.0", id: 1, method: "echo", params: { x: 1 } });
    emit({ jsonrpc: "2.0", id: 2, method: "session/request_permission", params: {} });
    emit({ jsonrpc: "2.0", method: "$/cancel_request", params: { requestId: 2 } });
    await vi.waitFor(() => expect(runner.sent).toHaveLength(2));
    expect(sent()).toContainEqual({ jsonrpc: "2.0", id: 1, result: { x: 1 } });
    expect(sent()).toContainEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: REQUEST_CANCELLED, message: "Request cancelled" },
    });
  });

  it("rejects every waiting request when the run ends, with its reason and stderr", async () => {
    const connection = await openAcpConnection(START);
    const ended = vi.fn();
    connection.onEnd(ended);
    const first = connection.request("initialize", {}, { timeoutMs: 60_000 });
    const second = connection.request("session/prompt", {});
    exit("ar_1", { code: 3 });
    for (const answer of [first, second]) {
      const error = await answer.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AcpRunEndedError);
      expect((error as AcpRunEndedError).message).toBe("The agent program ended with exit code 3.");
      expect((error as AcpRunEndedError).stderrTail).toEqual(["boom"]);
      expect((error as AcpRunEndedError).reason).toBeNull();
    }
    expect(ended).toHaveBeenCalledTimes(1);
    await expect(connection.request("x", {})).rejects.toBeInstanceOf(AcpRunEndedError);
    expect(runner.lines.size).toBe(0);
    expect(runner.exits.size).toBe(0);
  });

  it("names the runner's reason when it ended the run", async () => {
    const connection = await openAcpConnection(START);
    const answer = connection.request("session/prompt", {});
    exit("ar_1", { code: null, reason: "line_too_long" });
    const error = (await answer.catch((caught: unknown) => caught)) as AcpRunEndedError;
    expect(error.reason).toBe("line_too_long");
    expect(error.message).toBe(
      "The agent program wrote a line too long to read, so RIM stopped it.",
    );
  });

  it("hears a run that ends before its id is known", async () => {
    runner.startAgentRun.mockImplementation(() => {
      exit("ar_1");
      return Promise.resolve("ar_1");
    });
    const connection = await openAcpConnection(START);
    expect(connection.ended).toBeInstanceOf(AcpRunEndedError);
  });

  it("stops listening when the run does not start", async () => {
    runner.startAgentRun.mockRejectedValue(new Error("fake-agent was not found."));
    await expect(openAcpConnection(START)).rejects.toThrow("fake-agent was not found.");
    expect(runner.lines.size).toBe(0);
    expect(runner.exits.size).toBe(0);
  });

  it("rejects a request whose line could not be written", async () => {
    const connection = await openAcpConnection(START);
    runner.sendAgentLine.mockRejectedValue(new Error("That run has ended."));
    await expect(connection.request("x", {})).rejects.toThrow("That run has ended.");
  });
});
