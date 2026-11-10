import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./agentRunner", async () =>
  (await import("../../../test/fakeAcpAgent")).fakeAcpAgent.module(),
);

import { fakeAcpAgent as agent, helloAnswer } from "../../../test/fakeAcpAgent";
import {
  AcpClient,
  mergeToolCall,
  parseSessionUpdate,
  type PermissionOutcome,
  type PermissionRequest,
  type SessionUpdate,
} from "./acpClient";
import { openAcpConnection } from "./acpConnection";

const RIM_SERVER = {
  type: "http" as const,
  name: "rim",
  url: "http://127.0.0.1:47821/mcp",
  headers: [{ name: "Authorization", value: "Bearer rimagent_secret" }],
};

async function client(onPermission?: (request: PermissionRequest) => Promise<PermissionOutcome>) {
  const updates: [string, SessionUpdate][] = [];
  const connection = await openAcpConnection({ program: "fake", args: [], cwd: "/p" });
  const acp = new AcpClient(connection, {
    onUpdate: (sessionId, update) => updates.push([sessionId, update]),
    onPermission: onPermission ?? (() => new Promise(() => {})),
  });
  return { acp, updates };
}

describe("AcpClient", () => {
  beforeEach(() => {
    agent.reset();
  });

  it("initializes with version 1, no file system or terminal, terminal sign-in, and RIM's name", async () => {
    agent.on("initialize", () => helloAnswer(true, { sessionCapabilities: { resume: {} } }));
    const { acp } = await client();
    const hello = await acp.initialize();
    const params = agent.requests("initialize")[0].params as Record<string, unknown>;
    expect(params.protocolVersion).toBe(1);
    expect(params.clientCapabilities).toEqual({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      auth: { terminal: true },
    });
    expect(params.clientInfo).toMatchObject({ name: "rim", title: "RIM" });
    expect(typeof (params.clientInfo as { version: unknown }).version).toBe("string");
    expect(hello.agentCapabilities).toMatchObject({
      loadSession: true,
      resumeSession: true,
      mcpCapabilities: { http: true, sse: false },
    });
    expect(hello.agentInfo).toEqual({ name: "fake-agent", title: "Fake Agent", version: "1.0.0" });
    expect(hello.authMethods).toEqual([]);
  });

  it("reads each sign-in method with its kind, terminal arguments and variables", async () => {
    agent.on("initialize", () => ({
      ...helloAnswer(),
      authMethods: [
        { id: "browser", name: "Log in", description: "Opens the browser" },
        {
          id: "claude-ai-login",
          name: "Claude account",
          type: "terminal",
          args: ["--cli", "auth", "login", 7],
          env: { ACP_LOGIN: "1", BAD: 2 },
        },
        { id: "plain-terminal", name: "Terminal", type: "terminal" },
        { id: "key", name: "API key", type: "env_var", vars: [{ name: "CODEX_API_KEY" }] },
        { id: "old-key", name: "Old key", type: "env_var", varName: "GEMINI_API_KEY" },
        { id: "no-name" },
      ],
    }));
    const { acp } = await client();
    const hello = await acp.initialize();
    expect(hello.authMethods).toEqual([
      {
        id: "browser",
        name: "Log in",
        description: "Opens the browser",
        type: "agent",
        args: [],
        env: {},
        vars: [],
      },
      {
        id: "claude-ai-login",
        name: "Claude account",
        description: null,
        type: "terminal",
        args: ["--cli", "auth", "login"],
        env: { ACP_LOGIN: "1" },
        vars: [],
      },
      {
        id: "plain-terminal",
        name: "Terminal",
        description: null,
        type: "terminal",
        args: [],
        env: {},
        vars: [],
      },
      {
        id: "key",
        name: "API key",
        description: null,
        type: "env_var",
        args: [],
        env: {},
        vars: ["CODEX_API_KEY"],
      },
      {
        id: "old-key",
        name: "Old key",
        description: null,
        type: "env_var",
        args: [],
        env: {},
        vars: ["GEMINI_API_KEY"],
      },
    ]);
  });

  it("asks the agent to sign in with a method it offered, never a terminal one", async () => {
    agent
      .on("initialize", () => ({
        ...helloAnswer(),
        authMethods: [
          { id: "browser", name: "Log in" },
          { id: "tty", name: "Terminal", type: "terminal" },
        ],
      }))
      .on("authenticate", () => ({}));
    const { acp } = await client();
    await acp.initialize();
    await acp.authenticate("browser");
    expect(agent.requests("authenticate")[0].params).toEqual({ methodId: "browser" });
    await expect(acp.authenticate("tty")).rejects.toThrow("runs in a terminal");
    await expect(acp.authenticate("other")).rejects.toThrow("did not offer");
    expect(agent.requests("authenticate")).toHaveLength(1);
  });

  it("refuses an agent that speaks another protocol version", async () => {
    agent.on("initialize", () => ({ ...helloAnswer(), protocolVersion: 2 }));
    const { acp } = await client();
    await expect(acp.initialize()).rejects.toThrow(
      "This agent speaks version 2 of the Agent Client Protocol, and RIM speaks only version 1.",
    );
    expect(acp.agent).toBeNull();
  });

  it("refuses an agent that names no protocol version", async () => {
    agent.on("initialize", () => ({ agentCapabilities: {} }));
    const { acp } = await client();
    await expect(acp.initialize()).rejects.toThrow(
      "This agent did not say which version of the Agent Client Protocol it speaks.",
    );
  });

  it("opens a session with RIM's server as an http entry with its header", async () => {
    agent
      .on("initialize", () => helloAnswer())
      .on("session/new", () => ({
        sessionId: "sess_1",
        modes: {
          currentModeId: "ask",
          availableModes: [
            { id: "ask", name: "Ask" },
            { id: "code", name: "Code", description: "Edits files" },
            { id: 3 },
          ],
        },
      }));
    const { acp } = await client();
    await acp.initialize();
    const opened = await acp.newSession({ cwd: "/home/a/project", mcpServers: [RIM_SERVER] });
    expect(agent.requests("session/new")[0].params).toEqual({
      cwd: "/home/a/project",
      mcpServers: [RIM_SERVER],
    });
    expect(opened).toEqual({
      sessionId: "sess_1",
      modes: {
        currentModeId: "ask",
        availableModes: [
          { id: "ask", name: "Ask", description: null },
          { id: "code", name: "Code", description: "Edits files" },
        ],
      },
    });
  });

  it("opens a session without servers when given none", async () => {
    agent.on("session/new", () => ({ sessionId: "sess_2" }));
    const { acp } = await client();
    const opened = await acp.newSession({ cwd: "/p", mcpServers: [] });
    expect(agent.requests("session/new")[0].params).toEqual({ cwd: "/p", mcpServers: [] });
    expect(opened).toEqual({ sessionId: "sess_2", modes: null });
  });

  it("refuses a session answer without a session id", async () => {
    agent.on("session/new", () => ({}));
    const { acp } = await client();
    await expect(acp.newSession({ cwd: "/p", mcpServers: [] })).rejects.toThrow(
      "The agent did not open a session.",
    );
  });

  it("loads or resumes only when the agent offers it", async () => {
    agent
      .on("initialize", () => helloAnswer(true, { loadSession: false }))
      .on("session/load", () => ({}));
    const { acp } = await client();
    await acp.initialize();
    await expect(acp.loadSession("s", { cwd: "/p", mcpServers: [] })).rejects.toThrow(
      "This agent can't open earlier sessions.",
    );
    await expect(acp.resumeSession("s", { cwd: "/p", mcpServers: [] })).rejects.toThrow(
      "This agent can't continue earlier sessions.",
    );
    expect(agent.requests("session/load")).toHaveLength(0);
    expect(agent.requests("session/resume")).toHaveLength(0);
  });

  it("sends a prompt, hears its updates and returns the stop reason", async () => {
    agent.on("session/prompt", (_params, id) => {
      queueMicrotask(() => {
        agent.update("sess_1", {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hel" },
          messageId: "m1",
        });
        agent.update("sess_1", {
          sessionUpdate: "tool_call",
          toolCallId: "call_1",
          title: "Reading config",
          kind: "read",
          status: "pending",
          locations: [{ path: "/p/config.json", line: 3 }],
          rawInput: { path: "/p/config.json" },
        });
        agent.update("sess_1", {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_1",
          status: "completed",
          content: [
            {
              type: "diff",
              path: "/p/config.json",
              oldText: '{"debug":false}',
              newText: '{"debug":true}',
            },
          ],
        });
        agent.update("sess_1", { sessionUpdate: "usage_update", used: 1, size: 2 });
        agent.respond(id, { stopReason: "end_turn" });
      });
      return undefined;
    });
    const { acp, updates } = await client();
    await expect(acp.prompt("sess_1", [{ type: "text", text: "Fix it" }])).resolves.toBe(
      "end_turn",
    );
    expect(agent.requests("session/prompt")[0].params).toEqual({
      sessionId: "sess_1",
      prompt: [{ type: "text", text: "Fix it" }],
    });
    expect(updates.map(([sessionId, update]) => [sessionId, update.kind])).toEqual([
      ["sess_1", "agent_message_chunk"],
      ["sess_1", "tool_call"],
      ["sess_1", "tool_call_update"],
      ["sess_1", "unknown"],
    ]);
    const [, created] = updates[1];
    const [, patched] = updates[2];
    if (created.kind !== "tool_call" || patched.kind !== "tool_call_update") throw new Error();
    expect(mergeToolCall(created.toolCall, patched.patch)).toEqual({
      toolCallId: "call_1",
      title: "Reading config",
      kind: "read",
      status: "completed",
      locations: [{ path: "/p/config.json", line: 3 }],
      rawInput: { path: "/p/config.json" },
      content: [
        {
          type: "diff",
          path: "/p/config.json",
          oldText: '{"debug":false}',
          newText: '{"debug":true}',
        },
      ],
    });
  });

  it("answers a permission request with the option the person chose", async () => {
    const seen: PermissionRequest[] = [];
    const { acp } = await client((request) => {
      seen.push(request);
      return Promise.resolve({ outcome: "selected", optionId: "allow-once" });
    });
    void acp;
    agent.ask(5, "session/request_permission", {
      sessionId: "sess_1",
      toolCall: { toolCallId: "call_1", title: "Run tests", kind: "execute" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        { optionId: "weird", name: "Weird", kind: "not_a_kind" },
      ],
    });
    await vi.waitFor(() => expect(agent.received).toHaveLength(1));
    expect(agent.received[0]).toEqual({
      jsonrpc: "2.0",
      id: 5,
      result: { outcome: { outcome: "selected", optionId: "allow-once" } },
    });
    expect(seen[0]).toMatchObject({
      sessionId: "sess_1",
      toolCall: { toolCallId: "call_1", title: "Run tests", kind: "execute" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    });
  });

  it("answers cancelled for an option the agent did not offer", async () => {
    await client(() => Promise.resolve({ outcome: "selected", optionId: "made-up" }));
    agent.ask(6, "session/request_permission", {
      sessionId: "sess_1",
      toolCall: { toolCallId: "call_1" },
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    });
    await vi.waitFor(() => expect(agent.received).toHaveLength(1));
    expect(agent.received[0].result).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("answers every waiting permission request cancelled when the turn is cancelled", async () => {
    const signals: AbortSignal[] = [];
    const { acp } = await client((request) => {
      signals.push(request.signal);
      return new Promise(() => {});
    });
    for (const id of [7, 8]) {
      agent.ask(id, "session/request_permission", {
        sessionId: "sess_1",
        toolCall: { toolCallId: `call_${id}` },
        options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
      });
    }
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    await acp.cancel("sess_1");
    await vi.waitFor(() => expect(agent.received).toHaveLength(3));
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(agent.requests("session/cancel")).toEqual([
      { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "sess_1" } },
    ]);
    const answers = agent.received.filter((message) => message.id === 7 || message.id === 8);
    expect(answers.map((message) => message.result)).toEqual([
      { outcome: { outcome: "cancelled" } },
      { outcome: { outcome: "cancelled" } },
    ]);
  });

  it("sets a mode", async () => {
    agent.on("session/set_mode", () => ({}));
    const { acp } = await client();
    await acp.setMode("sess_1", "code");
    expect(agent.requests("session/set_mode")[0].params).toEqual({
      sessionId: "sess_1",
      modeId: "code",
    });
  });
});

describe("parseSessionUpdate", () => {
  it("reads each kind it knows and keeps the rest as unknown", () => {
    expect(
      parseSessionUpdate({
        sessionUpdate: "plan",
        entries: [
          { content: "Read the logs", priority: "high", status: "completed" },
          { content: "Fix", priority: "urgent", status: "later" },
          { priority: "low" },
        ],
      }),
    ).toEqual({
      kind: "plan",
      entries: [
        { content: "Read the logs", priority: "high", status: "completed" },
        { content: "Fix", priority: "medium", status: "pending" },
      ],
    });
    expect(
      parseSessionUpdate({
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "web", description: "Search", input: { hint: "query" } }],
      }),
    ).toEqual({
      kind: "available_commands_update",
      commands: [{ name: "web", description: "Search", hint: "query" }],
    });
    expect(
      parseSessionUpdate({ sessionUpdate: "current_mode_update", currentModeId: "x" }),
    ).toEqual({ kind: "current_mode_update", currentModeId: "x" });
    expect(
      parseSessionUpdate({ sessionUpdate: "agent_thought_chunk", content: { type: "text" } }),
    ).toEqual({ kind: "agent_thought_chunk", content: { type: "unknown" }, messageId: null });
    expect(parseSessionUpdate({ sessionUpdate: "tool_call" })).toEqual({ kind: "unknown" });
    expect(parseSessionUpdate({ sessionUpdate: "compaction_update" })).toEqual({ kind: "unknown" });
    expect(parseSessionUpdate("plan")).toEqual({ kind: "unknown" });
  });

  it("keeps an unknown tool kind as other and leaves out null fields of an update", () => {
    const update = parseSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "c",
      kind: "teleport",
      title: null,
      rawInput: null,
      content: [{ type: "terminal", terminalId: "t1" }, { type: "html" }],
    });
    expect(update).toEqual({
      kind: "tool_call_update",
      patch: { toolCallId: "c", kind: "other", content: [{ type: "terminal", terminalId: "t1" }] },
    });
  });
});
